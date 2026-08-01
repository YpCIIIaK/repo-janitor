import type { Issue, IssueCategory, Severity } from "@/lib/mock-data"
import { matchesScanner } from "@/lib/scanners"

/**
 * Pure filters for the Issues table — kept out of the component so the
 * combinations (severity × category × scanner × changes) can be unit-tested
 * without mounting React.
 */

export type SeverityFilter = "all" | "actionable" | Severity
export type CategoryFilter = "all" | IssueCategory

export function matchesSeverity(issue: Issue, severity: SeverityFilter): boolean {
  if (severity === "all") return true
  if (severity === "actionable") return issue.severity !== "info"
  return issue.severity === severity
}

export function matchesCategory(issue: Issue, category: CategoryFilter): boolean {
  return category === "all" || issue.category === category
}

export function filterIssues(
  issues: Issue[],
  opts: {
    severity?: SeverityFilter
    category?: CategoryFilter
    /** Scanner id, or `"all"`. */
    scanner?: string
    /** When set with `newIds`, keep only findings in that set. */
    changesOnly?: boolean
    newIds?: Set<string>
  },
): Issue[] {
  const severity = opts.severity ?? "all"
  const category = opts.category ?? "all"
  const scanner = opts.scanner ?? "all"
  return issues.filter((issue) => {
    if (!matchesSeverity(issue, severity)) return false
    if (!matchesCategory(issue, category)) return false
    if (scanner !== "all" && !matchesScanner(issue, scanner)) return false
    if (opts.changesOnly && opts.newIds && !opts.newIds.has(issue.id)) return false
    return true
  })
}
