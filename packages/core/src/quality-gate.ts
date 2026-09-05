import type { ScanReport, Severity } from "./schema"

export type NewFindingThreshold = Severity | "never"
const rank: Record<Severity, number> = { critical: 3, warning: 2, info: 1 }

/** Gate new debt while allowing an existing backlog to be reduced gradually. */
export function evaluateQualityGate(report: ScanReport, options: {
  baseline?: ScanReport
  failOnNew?: NewFindingThreshold
  minScore?: number
}) {
  if (options.baseline && `${options.baseline.repo.owner}/${options.baseline.repo.name}`.toLowerCase() !== `${report.repo.owner}/${report.repo.name}`.toLowerCase()) {
    throw new Error("Baseline belongs to a different repository")
  }
  const previous = new Set(options.baseline?.issues.map((issue) => issue.id) ?? [])
  const added = report.issues.filter((issue) => !previous.has(issue.id))
  const threshold = options.failOnNew ?? "never"
  const blocking = threshold === "never" ? [] : added.filter((issue) => rank[issue.severity] >= rank[threshold])
  const belowMinimum = options.minScore !== undefined && report.score < options.minScore
  const incomplete = (report.diagnostics?.failedScanners.length ?? 0) > 0
  return { passed: blocking.length === 0 && !belowMinimum && !incomplete, added, blocking, belowMinimum, incomplete }
}
