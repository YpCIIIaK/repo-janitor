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
import { workflowSecurityScanner } from "./scanners/workflow-security"
import { eolRuntimeScanner } from "./scanners/eol-runtime"
import { docsDriftScanner } from "./scanners/docs-drift"
import { configConflictScanner } from "./scanners/config-conflict"
import { licenseRiskScanner } from "./scanners/license-risk"
import { ciHealthScanner } from "./scanners/ci-health"
import { duplicateCodeScanner } from "./scanners/duplicate-code"
import { supplyChainScanner } from "./scanners/supply-chain"

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
  workflowSecurityScanner,
  eolRuntimeScanner,
  docsDriftScanner,
  configConflictScanner,
  licenseRiskScanner,
  ciHealthScanner,
  duplicateCodeScanner,
  supplyChainScanner,
]

/** Severity penalties per finding, before the per-tier discount in
 * {@link SEVERITY_CURVE}. info is deliberately near-cosmetic — a quarter of a
 * point — so a pile of low-signal notes cannot meaningfully move the grade; a
 * repo can override these via .repo-anti-rot.json. */
export type SeverityWeights = { critical: number; warning: number; info: number; infoCap?: number }

/** Severity tiers taper after their full-weight stretch. Informational findings
 * additionally have a 10-point budget: their volume measures maintenance work,
 * not evidence of serious defects. Warning and critical tiers remain uncapped.
 */
export interface PenaltyCurve {
  /** How many findings are charged at full weight before the discount begins. */
  full: number
  /** Tail exponent, 0 < alpha < 1. Lower is a steeper discount. */
  alpha: number
}

export const SEVERITY_CURVE: Record<"critical" | "warning" | "info", PenaltyCurve> = {
  critical: { full: 2, alpha: 0.7 },
  warning: { full: 8, alpha: 0.5 },
  info: { full: 20, alpha: 0.4 },
}

/**
 * Points one severity tier subtracts for `count` findings.
 *
 * Continuous at the join — the (full+1)-th finding still costs a full weight,
 * and only the ones after it are discounted — so there is no cliff where adding
 * a finding suddenly becomes cheap.
 */
export function tierPenalty(count: number, weight: number, curve: PenaltyCurve): number {
  if (count <= 0) return 0
  const raw = count <= curve.full
    ? count * weight
    : weight * (curve.full + Math.pow(count - curve.full, curve.alpha))
  return raw
}

/**
 * 0–100 score: starts at 100, subtracts each severity tier's penalty, rounds,
 * clamps to 0.
 */
export function computeScore(issues: Issue[], weights: SeverityWeights = DEFAULT_WEIGHTS): number {
  const counts: Record<"critical" | "warning" | "info", number> = { critical: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++
  let penalty = 0
  for (const sev of ["critical", "warning", "info"] as const) {
    const raw = tierPenalty(counts[sev], weights[sev], SEVERITY_CURVE[sev])
    penalty += sev === "info" ? Math.min(raw, weights.infoCap ?? Infinity) : raw
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
  const completedScanners: string[] = []
  const failedScanners: string[] = []
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
      completedScanners.push(scanner.id)
    } catch (err) {
      failedScanners.push(scanner.id)
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
    diagnostics: { completedScanners, failedScanners, history: ctx.history ?? "unavailable" },
    // Echo effective weights so the dashboard recomputes the score identically.
    config: { weights },
    metrics: { linesOfCode },
    profile,
  }

  // fail loudly if we ever drift from the shared schema
  return scanReportSchema.parse(report)
}
