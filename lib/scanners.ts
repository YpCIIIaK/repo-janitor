import type { Issue, IssueCategory } from "@/lib/mock-data"
import { CHECK_FAMILIES } from "@/lib/landing-facts"

/**
 * Human labels and helpers for the engine's scanner ids.
 *
 * Findings carry `scanner` (stamped by the engine). The Issues table used to
 * pretend "Group by scanner" meant the seven umbrella categories — this module
 * is the place that distinction lives so the UI can filter and group by the
 * real check that produced a finding (`ci-health`, `license-risk`, …).
 */

/** Title-case hyphenated ids; keep well-known acronyms loud. */
const ACRONYMS = new Set(["ci", "eol", "osv", "sarif", "api", "aws"])

/** Friendly overrides where title-case of the id reads awkwardly. */
const LABEL_OVERRIDES: Record<string, string> = {
  "env-lifecycle": "Env Lifecycle",
  "todo-debt": "TODO Debt",
  "dead-code": "Dead Code",
  "dependency-funeral": "Dependency Funeral",
  "stale-branch": "Stale Branch",
  "vulnerable-deps": "Vulnerable Deps",
  "outdated-deps": "Outdated Deps",
  "lockfile-drift": "Lockfile Drift",
  "eol-runtime": "EOL Runtime",
  "license-risk": "License Risk",
  "insecure-code": "Insecure Code",
  "workflow-security": "Workflow Security",
  "project-hygiene": "Project Hygiene",
  "leftover-debug": "Leftover Debug",
  "broken-doc-links": "Broken Doc Links",
  "bus-factor": "Bus Factor",
  "repo-bloat": "Repo Bloat",
  "skipped-tests": "Skipped Tests",
  "commented-code": "Commented Code",
  "dead-links": "Dead Links",
  "docs-drift": "Docs Drift",
  "config-conflict": "Config Conflict",
  "ci-health": "CI Health",
  "duplicate-code": "Duplicate Code",
}

/**
 * Id prefixes used before the `scanner` field existed.
 * Narrow and ordered longest-first so `doclink-` wins over a hypothetical `doc-`.
 */
const LEGACY_PREFIXES: { prefix: string; scanner: string }[] = [
  { prefix: "insecure-", scanner: "insecure-code" },
  { prefix: "secret-", scanner: "secrets" },
  { prefix: "vuln-", scanner: "vulnerable-deps" },
  { prefix: "deadlink-", scanner: "dead-links" },
  { prefix: "doclink-", scanner: "broken-doc-links" },
  { prefix: "workflow-", scanner: "workflow-security" },
  { prefix: "dockerfile-", scanner: "dockerfile" },
  { prefix: "license-", scanner: "license-risk" },
  { prefix: "ci-health-", scanner: "ci-health" },
  { prefix: "docs-drift-", scanner: "docs-drift" },
  { prefix: "config-conflict-", scanner: "config-conflict" },
  { prefix: "duplicate-", scanner: "duplicate-code" },
  { prefix: "commented-", scanner: "commented-code" },
  { prefix: "skipped-", scanner: "skipped-tests" },
  { prefix: "debug-", scanner: "leftover-debug" },
  { prefix: "bloat-", scanner: "repo-bloat" },
  { prefix: "bus-", scanner: "bus-factor" },
  { prefix: "hygiene-", scanner: "project-hygiene" },
  { prefix: "dead-", scanner: "dead-code" },
  { prefix: "todo-", scanner: "todo-debt" },
  { prefix: "branch-", scanner: "stale-branch" },
  { prefix: "env-", scanner: "env-lifecycle" },
  { prefix: "dep-", scanner: "dependency-funeral" },
  { prefix: "outdated-", scanner: "outdated-deps" },
  { prefix: "lockfile-", scanner: "lockfile-drift" },
  { prefix: "eol-", scanner: "eol-runtime" },
]

/** Every scanner id the landing page (and therefore the engine) claims. */
export const KNOWN_SCANNERS: readonly string[] = CHECK_FAMILIES.flatMap((f) => f.scanners)

export function scannerLabel(id: string): string {
  if (LABEL_OVERRIDES[id]) return LABEL_OVERRIDES[id]
  return id
    .split("-")
    .map((part) => {
      if (ACRONYMS.has(part.toLowerCase())) return part.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(" ")
}

/**
 * Resolve which scanner produced a finding.
 *
 * Prefers the stamped field; falls back to id-prefix heuristics for older
 * stored reports so a filter still works on history that predates the stamp.
 */
export function resolveScanner(issue: Issue): string | null {
  if (issue.scanner) return issue.scanner
  for (const { prefix, scanner } of LEGACY_PREFIXES) {
    if (issue.id.startsWith(prefix)) return scanner
  }
  return null
}

export function matchesScanner(issue: Issue, scannerId: string): boolean {
  return resolveScanner(issue) === scannerId
}

export type ScannerCount = { id: string; count: number; label: string }

/**
 * Scanners that actually appear in the list, with counts — for a Select that
 * only offers options the user can hit.
 */
export function presentScanners(issues: Issue[]): ScannerCount[] {
  const counts = new Map<string, number>()
  for (const issue of issues) {
    const id = resolveScanner(issue)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, label: scannerLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
}

/** Scanners present among findings in a given umbrella category. */
export function presentScannersInCategory(
  issues: Issue[],
  category: IssueCategory | "all",
): ScannerCount[] {
  const pool = category === "all" ? issues : issues.filter((i) => i.category === category)
  return presentScanners(pool)
}
