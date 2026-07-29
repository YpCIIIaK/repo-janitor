import type { ScanReport } from "@/lib/server-store"
import type { Grade, Issue, IssueCategory, Severity } from "@/lib/mock-data"

/**
 * The projection of a scan report that may be published behind a share link.
 *
 * A full `ScanReport` is not shareable. It carries `evidence` (a line of the
 * offending source, and for secrets a masked credential), `detail` (which
 * scanners fill with specifics — package versions, env var names), `location`
 * (file path and line number) and `aiNote`. Publishing that would leak the shape
 * of somebody's codebase from a checkbox.
 *
 * So sharing does not "redact" the report — it BUILDS A NEW OBJECT containing
 * only fields chosen for it. That direction matters: a subtractive filter leaks
 * every field added later by default, and the field that gets added later is
 * always the interesting one. Here a new field has to be opted in, in this file,
 * by someone reading this comment.
 *
 * The consent text shown to the user (`consent.body` in lib/i18n.ts) describes
 * exactly this object. If you change what is stored, change that string in the
 * same commit — a privacy promise that drifts from the code is worse than no
 * promise at all.
 */

/** Findings listed individually on a shared page. The rest are counted, not named. */
export const SHARED_ISSUE_LIMIT = 10

/** A finding, reduced to what a reader needs to judge severity — and nothing else. */
export interface SharedIssue {
  title: string
  category: IssueCategory
  severity: Severity
}

export interface SharedReport {
  /** Owner/name of a PUBLIC repository — sharing is only offered for those. */
  repo: { owner: string; name: string }
  /**
   * Clone URL of that public repository, when known.
   *
   * Stored so a reader can run their own scan of the same repo from the shared
   * page. It reveals nothing the page did not already: owner/name are printed at
   * the top, and the repository is public by construction — the scanner refuses
   * anything else. Deriving it from owner/name instead would silently assume
   * GitHub and send GitLab readers to a 404.
   */
  repoUrl?: string
  generatedAt: string
  score: number
  grade: Grade
  counts: Record<Severity, number>
  /** Findings per category, highest first. */
  byCategory: { category: IssueCategory; count: number }[]
  totalIssues: number
  /** At most {@link SHARED_ISSUE_LIMIT}, worst first. */
  topIssues: SharedIssue[]
  /** Aggregate size/language stats. No paths — a language histogram is not a file tree. */
  profile?: {
    totalFiles: number
    languages: { language: string; loc: number }[]
    tools: string[]
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const issue of issues) counts[issue.severity]++
  return counts
}

function countByCategory(issues: Issue[]): { category: IssueCategory; count: number }[] {
  const tally = new Map<IssueCategory, number>()
  for (const issue of issues) tally.set(issue.category, (tally.get(issue.category) ?? 0) + 1)
  return [...tally.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

/**
 * Build the shareable projection of a report.
 *
 * Note this reads named fields off each issue rather than spreading it. Spreading
 * and deleting would carry `evidence` into the output the day someone renames it.
 */
export function toSharedReport(report: ScanReport, repoUrl?: string): SharedReport {
  const issues = report.issues ?? []

  const topIssues: SharedIssue[] = [...issues]
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.ageDays - a.ageDays ||
        a.title.localeCompare(b.title),
    )
    .slice(0, SHARED_ISSUE_LIMIT)
    .map((issue) => ({
      title: issue.title,
      category: issue.category,
      severity: issue.severity,
    }))

  const profile = (report as ScanReport & { profile?: unknown }).profile as
    | { totalFiles?: number; languages?: { language: string; loc: number }[]; tools?: string[] }
    | undefined

  return {
    repo: { owner: report.repo.owner, name: report.repo.name },
    ...(repoUrl ? { repoUrl } : {}),
    generatedAt: report.generatedAt,
    score: report.score,
    grade: report.grade,
    counts: countBySeverity(issues),
    byCategory: countByCategory(issues),
    totalIssues: issues.length,
    topIssues,
    ...(profile
      ? {
          profile: {
            totalFiles: profile.totalFiles ?? 0,
            languages: (profile.languages ?? []).map((l) => ({
              language: l.language,
              loc: l.loc,
            })),
            tools: profile.tools ?? [],
          },
        }
      : {}),
  }
}

/**
 * Fields that must never appear in a shared payload, named so the guarantee is
 * testable rather than merely intended.
 */
export const FORBIDDEN_SHARED_FIELDS = ["evidence", "detail", "location", "aiNote", "id"] as const

/**
 * Assert that a payload carries none of the forbidden fields, at any depth.
 *
 * Belt and braces over {@link toSharedReport}: this runs before anything is
 * written, so a future edit that widens the projection fails loudly at the point
 * of storage instead of quietly publishing file paths.
 */
export function assertShareable(payload: unknown): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (node === null || typeof node !== "object") return
    for (const [key, value] of Object.entries(node)) {
      if ((FORBIDDEN_SHARED_FIELDS as readonly string[]).includes(key)) {
        throw new Error(`Refusing to share: payload contains "${key}" at ${path || "<root>"}`)
      }
      walk(value, path ? `${path}.${key}` : key)
    }
  }
  walk(payload, "")
}
