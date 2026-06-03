import type { Issue, Severity } from "../schema"

/** Sort order for issues: most severe first, then oldest first. */
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 }

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (sev !== 0) return sev
    return b.ageDays - a.ageDays
  })
}

export function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++
  return counts
}
