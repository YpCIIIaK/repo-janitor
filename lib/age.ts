import type { Issue, Severity } from "@/lib/mock-data"

/**
 * Age distribution of findings — how long the rot has been sitting there.
 *
 * Old criticals are worse than fresh ones (they've survived many commits without
 * anyone fixing them), so bucketing findings by `ageDays` and severity surfaces
 * entrenched debt. Findings the scanner can't date (ageDays 0, e.g. a missing
 * README) land in the youngest bucket, which is the honest default.
 */

export interface AgeBucket {
  label: string
  critical: number
  warning: number
  info: number
  total: number
}

const BUCKETS: { label: string; max: number }[] = [
  { label: "<1mo", max: 30 },
  { label: "1–3mo", max: 90 },
  { label: "3–6mo", max: 180 },
  { label: "6–12mo", max: 365 },
  { label: ">1y", max: Infinity },
]

/** Group findings into fixed age buckets, counting by severity. */
export function ageHistogram(issues: Issue[]): AgeBucket[] {
  const out: AgeBucket[] = BUCKETS.map((b) => ({
    label: b.label,
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  }))
  for (const issue of issues) {
    const days = Number.isFinite(issue.ageDays) ? Math.max(0, issue.ageDays) : 0
    const idx = BUCKETS.findIndex((b) => days < b.max)
    const bucket = out[idx === -1 ? out.length - 1 : idx]
    bucket[issue.severity as Severity]++
    bucket.total++
  }
  return out
}

/** Median age in days across findings (0 when none). For a quick "how stale" stat. */
export function medianAgeDays(issues: Issue[]): number {
  const ages = issues
    .map((i) => (Number.isFinite(i.ageDays) ? Math.max(0, i.ageDays) : 0))
    .sort((a, b) => a - b)
  if (ages.length === 0) return 0
  const mid = Math.floor(ages.length / 2)
  return ages.length % 2 ? ages[mid] : Math.round((ages[mid - 1] + ages[mid]) / 2)
}
