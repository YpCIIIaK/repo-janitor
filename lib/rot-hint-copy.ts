import type { MessageKey, PluralKey } from "@/lib/i18n"
import type { Trend } from "@/lib/rot-hint"

/**
 * Which message says a trend, in the reader's language.
 *
 * Pure and separate from `lib/rot-hint.ts`, for the same reason
 * `percentile-copy.ts` is separate from `percentile.ts`: the computation and the
 * wording have different audiences. The SVG card carries no locale and keeps its
 * English string; this is for the surfaces that do.
 *
 * "Today" and "yesterday" are their own messages rather than a count of zero or
 * one, because no language says them by counting. Everything else is a plural,
 * which in Russian means three forms and a rule about the last digit.
 */
export type TrendCopy =
  | { plural: false; key: MessageKey }
  | { plural: true; key: PluralKey; count: number }

export function trendCopy(trend: Trend): TrendCopy {
  const { kind, days } = trend

  if (kind === "improved") {
    if (days === 0) return { plural: false, key: "trend.improvedToday" }
    if (days === 1) return { plural: false, key: "trend.improvedYesterday" }
    return { plural: true, key: "trend.improvedDays", count: days }
  }

  if (kind === "rotting") {
    if (days === 0) return { plural: false, key: "trend.droppedToday" }
    if (days === 1) return { plural: false, key: "trend.rottingYesterday" }
    return { plural: true, key: "trend.rottingDays", count: days }
  }

  return { plural: true, key: "trend.unchangedDays", count: days }
}

/** True when the trend is bad news, so a surface can colour it accordingly. */
export function isDecline(trend: Trend): boolean {
  return trend.kind === "rotting"
}
