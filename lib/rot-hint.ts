/**
 * One-line “gentle shame” copy from score history — for the README card footer.
 *
 * Needs at least two scans. Prefers the emotional fact over raw timestamps:
 * how long since the score last went up, or how long it has been falling.
 */

export interface ScorePoint {
  at: string
  score: number
}

function daysBetween(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000))
}

function daysPhrase(days: number, kind: "improved" | "rotting"): string {
  if (kind === "improved") {
    if (days === 0) return "Improved today"
    if (days === 1) return "Last improved yesterday"
    return `Last improved ${days}d ago`
  }
  if (days === 0) return "Score dropped today"
  if (days === 1) return "Rotting since yesterday"
  return `Rotting ${days}d`
}

/**
 * Derive a short footer hint from ascending-or-unsorted score points.
 * `null` when there is nothing useful to say (first scan, or flat & recent).
 */
export function rotHint(history: ScorePoint[], nowMs: number = Date.now()): string | null {
  if (history.length < 2) return null

  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at))
  let lastImprovedAt: string | null = null
  let lastDeclinedAt: string | null = null

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].score
    const cur = sorted[i].score
    if (cur > prev) lastImprovedAt = sorted[i].at
    else if (cur < prev) lastDeclinedAt = sorted[i].at
  }

  // A decline after the last improvement (or with no improvement) is rotting.
  if (
    lastDeclinedAt &&
    (!lastImprovedAt || lastDeclinedAt.localeCompare(lastImprovedAt) > 0)
  ) {
    return daysPhrase(daysBetween(lastDeclinedAt, nowMs), "rotting")
  }

  if (lastImprovedAt) {
    return daysPhrase(daysBetween(lastImprovedAt, nowMs), "improved")
  }

  // Scores never moved — only nag if that has gone on a while.
  const span = daysBetween(sorted[0].at, nowMs)
  if (span >= 7) return `Unchanged ${span}d`
  return null
}
