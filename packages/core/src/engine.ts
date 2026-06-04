import type { Scanner, ScanContext } from "./scanner"
import { scanReportSchema, SCHEMA_VERSION, type Grade, type Issue, type ScanReport } from "./schema"
import { DEFAULT_WEIGHTS, INLINE_IGNORE_MARKER, INLINE_IGNORE_NEXT_LINE_MARKER } from "./config"
import { envLifecycleScanner } from "./scanners/env-lifecycle"
import { staleBranchScanner } from "./scanners/stale-branch"
import { todoDebtScanner } from "./scanners/todo-debt"
import { secretsScanner } from "./scanners/secrets"
import { dependencyFuneralScanner } from "./scanners/dependency-funeral"
import { lockfileDriftScanner } from "./scanners/lockfile-drift"
import { projectHygieneScanner } from "./scanners/project-hygiene"
import { leftoverDebugScanner } from "./scanners/leftover-debug"
import { brokenDocLinksScanner } from "./scanners/broken-doc-links"
import { busFactorScanner } from "./scanners/bus-factor"
import { deadCodeScanner } from "./scanners/dead-code"

/** Default scanner registry. Add new scanners here as they are implemented. */
export const defaultScanners: Scanner[] = [
  envLifecycleScanner,
  staleBranchScanner,
  todoDebtScanner,
  secretsScanner,
  dependencyFuneralScanner,
  lockfileDriftScanner,
  deadCodeScanner,
  projectHygieneScanner,
  leftoverDebugScanner,
  brokenDocLinksScanner,
  busFactorScanner,
]

/** Severity penalties. info is half-weighted by default so a pile of low-signal
 * notes dents the score gently; a repo can override these via .repo-anti-rot.json. */
export type SeverityWeights = { critical: number; warning: number; info: number }

/** 0–100 score: starts at 100, subtracts weighted penalties, rounds, clamps to 0. */
export function computeScore(issues: Issue[], weights: SeverityWeights = DEFAULT_WEIGHTS): number {
  const penalty = issues.reduce((sum, i) => sum + weights[i.severity], 0)
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

// Source extensions counted toward lines-of-code (config/markdown/json excluded).
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift|scala|vue|svelte)$/i

/** Sum of non-blank lines across recognised source files. Best-effort: a file
 * that can't be read is skipped. One extra read pass over source files. */
async function countLinesOfCode(ctx: ScanContext): Promise<number> {
  let loc = 0
  for (const file of ctx.files) {
    if (!CODE_RE.test(file.replace(/\\/g, "/"))) continue
    const content = await ctx.readFile(file)
    if (!content) continue
    for (const line of content.split("\n")) if (line.trim()) loc++
  }
  return loc
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
      issues.push(...(await scanner.run(ctx)))
    } catch (err) {
      ctx.log(`[repo-anti-rot] scanner "${scanner.id}" failed: ${String(err)}`)
    }
    completed++
    onProgress?.({ scanner: scanner.id, completed, total })
  }

  const weights = ctx.config?.weights ?? DEFAULT_WEIGHTS
  const visible = await applyInlineIgnores(issues, ctx)
  const score = computeScore(visible, weights)
  const linesOfCode = await countLinesOfCode(ctx)
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
  }

  // fail loudly if we ever drift from the shared schema
  return scanReportSchema.parse(report)
}
