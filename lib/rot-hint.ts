import { scoreToGrade } from "@/lib/score"

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

/**
 * What the score history says, before anybody puts it into words.
 *
 * Separated from the phrasing because the two readers disagree about language:
 * the README card is an SVG that is English everywhere, while the report page is
 * translated. Returning a finished English string would have put "Rotting 12d"
 * under a Russian heading — the same half-translated result as "Скан 1 month
 * ago", arrived at the same way.
 */
export type TrendKind = "improved" | "rotting" | "unchanged"

export interface Trend {
  kind: TrendKind
  /** Whole days since the thing described started. */
  days: number
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
 * Derive the trend from ascending-or-unsorted score points.
 * `null` when there is nothing useful to say (first scan, or flat & recent).
 */
export function rotTrend(history: ScorePoint[], nowMs: number = Date.now()): Trend | null {
  if (history.length < 2) return null

  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at))
  let lastImprovedAt: string | null = null

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].score > sorted[i - 1].score) lastImprovedAt = sorted[i].at
  }

  /**
   * Where the *current* decline started, not where it last continued.
   *
   * "Rotting 12d" reads as a duration, so it has to be one. Measuring from the
   * most recent drop said "Rotting since yesterday" about a repository that had
   * been sliding for a fortnight — the number that makes the point, understated
   * into a shrug, and it would keep resetting every time the score fell again.
   *
   * Walk back from the newest point through the run of drops and flat stretches;
   * an improvement ends the run. Each drop met on the way is older than the last,
   * so the final one recorded is where the slide began.
   */
  let declineStartedAt: string | null = null
  for (let i = sorted.length - 1; i > 0; i--) {
    const prev = sorted[i - 1].score
    const cur = sorted[i].score
    if (cur > prev) break
    if (cur < prev) declineStartedAt = sorted[i].at
  }

  if (declineStartedAt) {
    /**
     * An A is not rotting.
     *
     * The slide is real — 96 to 92 is a slide — but "Rotting 6d" printed under a
     * green A is the card contradicting itself, on a public README, about a
     * repository in better shape than almost anything it will be seen next to.
     * A word that strong has to be earned, and staying inside the top band is
     * the opposite of earning it.
     *
     * Nothing is substituted: with the accusation withdrawn there is no second
     * fact worth the line, and the footer falls back to the scan date. "Last
     * improved 200d ago" would be the same nag in a quieter voice.
     *
     * The threshold comes from `scoreToGrade` rather than a literal 90, so
     * moving the grade bands moves this with them.
     */
    const current = sorted[sorted.length - 1].score
    if (scoreToGrade(current) === "A") return null
    return { kind: "rotting", days: daysBetween(declineStartedAt, nowMs) }
  }

  if (lastImprovedAt) {
    return { kind: "improved", days: daysBetween(lastImprovedAt, nowMs) }
  }

  // Scores never moved — only nag if that has gone on a while.
  const span = daysBetween(sorted[0].at, nowMs)
  if (span >= 7) return { kind: "unchanged", days: span }
  return null
}

/**
 * The English wording, for the SVG card.
 *
 * The card carries no locale — it is an image in someone's README, read by
 * whoever passes — so it stays English, and this is the one place that decides
 * how the trend sounds there.
 */
export function rotHint(history: ScorePoint[], nowMs: number = Date.now()): string | null {
  const trend = rotTrend(history, nowMs)
  if (!trend) return null
  if (trend.kind === "unchanged") return `Unchanged ${trend.days}d`
  return daysPhrase(trend.days, trend.kind)
}
