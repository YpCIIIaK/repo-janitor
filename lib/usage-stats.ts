import type { UsageRow } from "@/lib/usage-db"
import type { UsageEventName } from "@/lib/usage"

/**
 * Turning usage rows into the handful of numbers worth looking at.
 *
 * Pure and free of `server-only` so it can be tested directly — the counting is
 * the part that can be quietly wrong, and it should not need a database to check.
 */

export interface UsageStats {
  since: string
  /** distinct visitor ids, excluding the shared `anonymous` bucket */
  uniqueVisitors: number
  /** events from callers with no id — counted, but not as people */
  anonymousEvents: number
  /** one entry per event name */
  events: { event: UsageEventName; count: number; amount: number; visitors: number }[]
  /** repositories scanned, most-scanned first */
  topRepos: { host: string; repo: string; scans: number; visitors: number }[]
  /** repo scans that ended in an error — a private URL, a typo, a dead host */
  failedScans: number
  /** commits scanned in total, across every history scan */
  commitsScanned: number
  /** per-day totals, oldest first, for a sparkline */
  daily: { date: string; scans: number; visitors: number }[]
  /** true when the row limit was hit and the numbers are therefore a floor */
  truncated: boolean
}

const TOP_REPOS = 20

function day(iso: string): string {
  return iso.slice(0, 10)
}

export function aggregateUsage(
  rows: UsageRow[],
  sinceIso: string,
  truncated = false,
): UsageStats {
  const visitors = new Set<string>()
  let anonymousEvents = 0

  const byEvent = new Map<UsageEventName, { count: number; amount: number; visitors: Set<string> }>()
  const byRepo = new Map<string, { host: string; repo: string; scans: number; visitors: Set<string> }>()
  const byDay = new Map<string, { scans: number; visitors: Set<string> }>()

  let failedScans = 0
  let commitsScanned = 0

  for (const row of rows) {
    const anon = row.visitor === "anonymous"
    if (anon) anonymousEvents++
    else visitors.add(row.visitor)

    const ev = byEvent.get(row.event) ?? { count: 0, amount: 0, visitors: new Set<string>() }
    ev.count++
    ev.amount += row.amount ?? 1
    if (!anon) ev.visitors.add(row.visitor)
    byEvent.set(row.event, ev)

    if (row.event === "commit-scan") commitsScanned += row.amount ?? 1

    if (row.event === "scan") {
      if (row.ok === false) failedScans++
      if (row.repo) {
        const key = `${row.host ?? ""}/${row.repo}`
        const entry = byRepo.get(key) ?? {
          host: row.host ?? "",
          repo: row.repo,
          scans: 0,
          visitors: new Set<string>(),
        }
        entry.scans++
        if (!anon) entry.visitors.add(row.visitor)
        byRepo.set(key, entry)
      }
      const d = byDay.get(day(row.at)) ?? { scans: 0, visitors: new Set<string>() }
      d.scans++
      if (!anon) d.visitors.add(row.visitor)
      byDay.set(day(row.at), d)
    }
  }

  return {
    since: sinceIso,
    uniqueVisitors: visitors.size,
    anonymousEvents,
    events: [...byEvent.entries()]
      .map(([event, v]) => ({ event, count: v.count, amount: v.amount, visitors: v.visitors.size }))
      .sort((a, b) => b.count - a.count),
    topRepos: [...byRepo.values()]
      .map(({ host, repo, scans, visitors: v }) => ({ host, repo, scans, visitors: v.size }))
      .sort((a, b) => b.scans - a.scans || a.repo.localeCompare(b.repo))
      .slice(0, TOP_REPOS),
    failedScans,
    commitsScanned,
    daily: [...byDay.entries()]
      .map(([date, v]) => ({ date, scans: v.scans, visitors: v.visitors.size }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    truncated,
  }
}
