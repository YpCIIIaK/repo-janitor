import type { Issue, Severity } from "@/lib/mock-data"
import { DEFAULT_WEIGHTS, type SeverityWeights } from "@/lib/score"

/**
 * "Hotspot" files — the source files attracting the most rot.
 *
 * Many findings carry a `file:line` (or `file @ sha`) location; grouping them by
 * file surfaces where decay concentrates, so a fix can be targeted instead of
 * chasing scattered issues. Findings without a real file location (branch refs
 * like `origin/x`, globs like `src/**`, bare `package.json`-style repo-level
 * items) are still useful but aren't a single "file" — we keep only locations
 * that resolve to a concrete path.
 */

export interface Hotspot {
  /** File path, e.g. `lib/payments.ts`. */
  file: string
  /** Issues whose location resolves to this file, worst severity first. */
  issues: Issue[]
  /** Per-severity counts. */
  counts: Record<Severity, number>
  /** Weighted penalty this file contributes (same weights as the score). */
  weight: number
}

/** Extract a concrete file path from an issue location, or null if not a file. */
export function locationToFile(location: string): string | null {
  // Drop a trailing " @ <sha>" suffix (history-based findings such as secrets).
  const head = location.split(" @ ")[0].trim()
  if (!head) return null
  // Strip a trailing ":line[:col]" so all lines of one file group together.
  const path = head.replace(/:\d+(?::\d+)?$/, "").trim()
  if (!path) return null
  // Branch refs and globs aren't single files.
  if (path.startsWith("origin/") || path.includes("*")) return null
  return path
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * Rank files by accumulated weighted penalty (ties broken by issue count, then
 * path). Returns at most `limit` files; files with a single low-info finding are
 * kept (they still localize rot) but naturally sink to the bottom.
 */
export function hotspotFiles(
  issues: Issue[],
  weights: SeverityWeights = DEFAULT_WEIGHTS,
  limit = 6,
): Hotspot[] {
  const byFile = new Map<string, Issue[]>()
  for (const issue of issues) {
    const file = locationToFile(issue.location)
    if (!file) continue
    const list = byFile.get(file)
    if (list) list.push(issue)
    else byFile.set(file, [issue])
  }

  const spots: Hotspot[] = [...byFile.entries()].map(([file, list]) => {
    const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
    let weight = 0
    for (const i of list) {
      counts[i.severity]++
      weight += weights[i.severity]
    }
    const sorted = [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    return { file, issues: sorted, counts, weight }
  })

  // Only files with more than one finding, OR any file at all if few exist, are
  // worth a dedicated "hotspot" callout — a lone finding is already in the table.
  const multi = spots.filter((s) => s.issues.length > 1)
  const ranked = (multi.length > 0 ? multi : spots).sort(
    (a, b) => b.weight - a.weight || b.issues.length - a.issues.length || a.file.localeCompare(b.file),
  )
  return ranked.slice(0, limit)
}
