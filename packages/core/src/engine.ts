import type { Scanner, ScanContext } from "./scanner"
import { scanReportSchema, SCHEMA_VERSION, type Grade, type Issue, type RepoProfile, type ScanReport } from "./schema"
import { extToLanguage, detectTools } from "./profile"
import { DEFAULT_WEIGHTS, INLINE_IGNORE_MARKER, INLINE_IGNORE_NEXT_LINE_MARKER, isMuted } from "./config"
import { envLifecycleScanner } from "./scanners/env-lifecycle"
import { staleBranchScanner } from "./scanners/stale-branch"
import { todoDebtScanner } from "./scanners/todo-debt"
import { secretsScanner } from "./scanners/secrets"
import { dependencyFuneralScanner } from "./scanners/dependency-funeral"
import { vulnerableDepsScanner } from "./scanners/vulnerable-deps"
import { outdatedDepsScanner } from "./scanners/outdated-deps"
import { lockfileDriftScanner } from "./scanners/lockfile-drift"
import { projectHygieneScanner } from "./scanners/project-hygiene"
import { leftoverDebugScanner } from "./scanners/leftover-debug"
import { brokenDocLinksScanner } from "./scanners/broken-doc-links"
import { busFactorScanner } from "./scanners/bus-factor"
import { deadCodeScanner } from "./scanners/dead-code"
import { repoBloatScanner } from "./scanners/repo-bloat"
import { dockerfileScanner } from "./scanners/dockerfile"
import { skippedTestsScanner } from "./scanners/skipped-tests"
import { commentedCodeScanner } from "./scanners/commented-code"
import { insecureCodeScanner } from "./scanners/insecure-code"
import { deadLinksScanner } from "./scanners/dead-links"

/** Default scanner registry. Add new scanners here as they are implemented. */
export const defaultScanners: Scanner[] = [
  envLifecycleScanner,
  staleBranchScanner,
  todoDebtScanner,
  secretsScanner,
  dependencyFuneralScanner,
  vulnerableDepsScanner,
  outdatedDepsScanner,
  lockfileDriftScanner,
  deadCodeScanner,
  projectHygieneScanner,
  leftoverDebugScanner,
  brokenDocLinksScanner,
  busFactorScanner,
  repoBloatScanner,
  dockerfileScanner,
  skippedTestsScanner,
  commentedCodeScanner,
  insecureCodeScanner,
  deadLinksScanner,
]

/** Severity penalties. info is deliberately near-cosmetic — a quarter of a point
 * each, capped at 8 total — so a pile of low-signal notes cannot meaningfully
 * move the grade; a repo can override these via .repo-anti-rot.json. */
export type SeverityWeights = { critical: number; warning: number; info: number }

/**
 * Maximum total points each severity tier can subtract. Below the cap the penalty
 * is exactly linear (`count * weight`), so typical repos score as before; the cap
 * only bites on pile-ups, stopping a swarm of low-signal notes from sinking a repo
 * harder than a real critical. Critical is uncapped on purpose — security findings
 * *should* be able to tank the score.
 *
 * The info cap is 8, not a round 10, so that info alone can never cost a whole
 * grade band: the narrowest band is 10 points wide (A≥90, B≥75, C≥60), so a repo
 * whose only findings are info-level keeps the grade its real problems earned it.
 */
export const SEVERITY_PENALTY_CAP: Record<keyof SeverityWeights, number> = {
  critical: Infinity,
  warning: 40,
  info: 8,
}

/**
 * 0–100 score: starts at 100, subtracts each severity tier's penalty
 * (`count * weight`, capped per tier), rounds, clamps to 0.
 */
export function computeScore(issues: Issue[], weights: SeverityWeights = DEFAULT_WEIGHTS): number {
  const counts: Record<keyof SeverityWeights, number> = { critical: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++
  let penalty = 0
  for (const sev of ["critical", "warning", "info"] as const) {
    // The cap never clips a *single* finding below the weight configured for it.
    // Otherwise lowering a default cap would silently override an explicit
    // `weights` override — a repo asking for `info: 10` would get 8.
    const cap = Math.max(SEVERITY_PENALTY_CAP[sev], weights[sev])
    penalty += Math.min(counts[sev] * weights[sev], cap)
  }
  return Math.max(0, Math.round(100 - penalty))
}

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A"
  if (score >= 75) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}

/** Progress event emitted as each scanner finishes — powers a real progress bar. */
export interface ScanProgress {
  /** scanner that just ran (undefined for the initial "start" tick) */
  scanner?: string
  /** scanners completed so far */
  completed: number
  /** total scanners that will run */
  total: number
}

/**
 * One read pass over source files that yields BOTH the lines-of-code metric and
 * the language breakdown for the repo profile, plus the detected tooling (from
 * the file list alone). Best-effort: a file that can't be read still counts
 * toward its language's file tally, just with zero lines. Languages are sorted
 * by lines of code descending.
 */
async function buildMetricsAndProfile(
  ctx: ScanContext,
): Promise<{ linesOfCode: number; profile: RepoProfile }> {
  const langs = new Map<string, { files: number; loc: number }>()

  for (const file of ctx.files) {
    const language = extToLanguage(file)
    if (!language) continue
    const entry = langs.get(language) ?? { files: 0, loc: 0 }
    entry.files++
    const content = await ctx.readFile(file)
    if (content) {
      for (const line of content.split("\n")) if (line.trim()) entry.loc++
    }
    langs.set(language, entry)
  }

  const languages = [...langs.entries()]
    .map(([language, v]) => ({ language, files: v.files, loc: v.loc }))
    .sort((a, b) => b.loc - a.loc || b.files - a.files || a.language.localeCompare(b.language))

  return {
    linesOfCode: languages.reduce((sum, l) => sum + l.loc, 0),
    profile: { totalFiles: ctx.files.length, languages, tools: detectTools(ctx.files) },
  }
}

const LOCATION_RE = /^(.+?):(\d+)$/

/**
 * Drop findings whose flagged line — or the line directly above it — carries the
 * inline ignore marker (`// repo-anti-rot-ignore`). Centralized here so scanners
 * stay marker-agnostic. Only findings with a `file:line` location can be inline-
 * ignored; the rest pass through untouched. Files are read once and cached.
 */
async function applyInlineIgnores(issues: Issue[], ctx: ScanContext): Promise<Issue[]> {
  const cache = new Map<string, string[] | null>()
  const out: Issue[] = []
  for (const issue of issues) {
    const m = issue.location.match(LOCATION_RE)
    const line = m ? parseInt(m[2], 10) : 0
    if (!m || !line) {
      out.push(issue)
      continue
    }
    const file = m[1]
    let lines = cache.get(file)
    if (lines === undefined) {
      const content = await ctx.readFile(file)
      lines = content ? content.split(/\r?\n/) : null
      cache.set(file, lines)
    }
    const onLine = lines?.[line - 1] ?? ""
    const above = lines?.[line - 2] ?? ""
    // Same-line marker (but not the -next-line variant, which targets the line below).
    const sameLine = onLine.includes(INLINE_IGNORE_MARKER) && !onLine.includes(INLINE_IGNORE_NEXT_LINE_MARKER)
    const nextLine = above.includes(INLINE_IGNORE_NEXT_LINE_MARKER)
    if (sameLine || nextLine) continue
    out.push(issue)
  }
  return out
}

/**
 * Run all scanners against a context and assemble a validated ScanReport.
 * Each scanner is isolated: a thrown error is logged and skipped, not fatal.
 *
 * `onProgress` fires once at the start and again after every scanner, so callers
 * (CLI/route/UI) can report genuine per-scanner progress instead of faking it.
 */
export async function runScan(
  ctx: ScanContext,
  scanners: Scanner[] = defaultScanners,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanReport> {
  const issues: Issue[] = []
  const total = scanners.length
  onProgress?.({ completed: 0, total })
  let completed = 0
  for (const scanner of scanners) {
    try {
      // Stamp the producing scanner here rather than asking every scanner to set
      // it: one place, impossible to forget, and a scanner cannot claim to be
      // another one.
      for (const issue of await scanner.run(ctx)) {
        issues.push({ ...issue, scanner: scanner.id })
      }
    } catch (err) {
      ctx.log(`[repo-anti-rot] scanner "${scanner.id}" failed: ${String(err)}`)
    }
    completed++
    onProgress?.({ scanner: scanner.id, completed, total })
  }

  const weights = ctx.config?.weights ?? DEFAULT_WEIGHTS
  const mute = ctx.config?.mute ?? []
  // Two suppression layers: inline markers in source, then config `mute` rules
  // (reviewed/accepted findings). Both drop findings before they reach the score.
  const inlineVisible = await applyInlineIgnores(issues, ctx)
  const visible = mute.length ? inlineVisible.filter((i) => !isMuted(i, mute)) : inlineVisible
  const score = computeScore(visible, weights)
  const { linesOfCode, profile } = await buildMetricsAndProfile(ctx)
  const report: ScanReport = {
    schemaVersion: SCHEMA_VERSION,
    repo: ctx.repo,
    generatedAt: new Date().toISOString(),
    score,
    grade: scoreToGrade(score),
    issues: visible,
    // Echo effective weights so the dashboard recomputes the score identically.
    config: { weights },
    metrics: { linesOfCode },
    profile,
  }

  // fail loudly if we ever drift from the shared schema
  return scanReportSchema.parse(report)
}
