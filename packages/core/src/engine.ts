import type { Scanner, ScanContext } from "./scanner"
import { scanReportSchema, SCHEMA_VERSION, type Grade, type Issue, type ScanReport } from "./schema"
import { envLifecycleScanner } from "./scanners/env-lifecycle"
import { staleBranchScanner } from "./scanners/stale-branch"
import { todoDebtScanner } from "./scanners/todo-debt"
import { secretsScanner } from "./scanners/secrets"
import { dependencyFuneralScanner } from "./scanners/dependency-funeral"
import { deadCodeScanner } from "./scanners/dead-code"

/** Default scanner registry. Add new scanners here as they are implemented. */
export const defaultScanners: Scanner[] = [
  envLifecycleScanner,
  staleBranchScanner,
  todoDebtScanner,
  secretsScanner,
  dependencyFuneralScanner,
  deadCodeScanner,
]

// info is half-weighted (0.5) so a pile of low-signal notes (examples, fixtures,
// "nice to know" findings) dents the score gently instead of tanking it.
const SEVERITY_WEIGHT = { critical: 10, warning: 3, info: 0.5 } as const

/** 0–100 score: starts at 100, subtracts weighted penalties, rounds, clamps to 0. */
export function computeScore(issues: Issue[]): number {
  const penalty = issues.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0)
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

  const score = computeScore(issues)
  const report: ScanReport = {
    schemaVersion: SCHEMA_VERSION,
    repo: ctx.repo,
    generatedAt: new Date().toISOString(),
    score,
    grade: scoreToGrade(score),
    issues,
  }

  // fail loudly if we ever drift from the shared schema
  return scanReportSchema.parse(report)
}
