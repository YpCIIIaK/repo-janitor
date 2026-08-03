import { MIN_SAMPLE } from "@/lib/scan-stats"
import { scoreToGrade } from "@/lib/score"
import type { Grade } from "@/lib/mock-data"

/**
 * What everything scanned so far looks like, in three numbers.
 *
 * For the landing page, where a first-time reader has no idea whether 74 is
 * good. "The median repository scores 70" answers that before they scan
 * anything, and it is the same data the percentile is drawn from — so the
 * landing page and the report page cannot tell different stories.
 *
 * Deliberately not npm downloads. Those are 411 and almost all of them are
 * mirrors and security scanners: three published versions with near-identical
 * counts, spiking on publish days rather than on weekdays. Printing that as
 * social proof would be stating something we know to be untrue, on the front
 * page of a tool whose entire job is finding exactly that — and it is
 * disprovable in ten seconds from a public API.
 */

export interface ScanSummary {
  /** How many scans the numbers are drawn from. */
  count: number
  /** Middle score of the distribution. */
  median: number
  /** How many scans landed in each band, worst-to-best order decided by the UI. */
  grades: Record<Grade, number>
}

const EMPTY_GRADES: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }

/**
 * Median, not mean.
 *
 * A handful of zeros — and there are zeros, a repository with a dozen live CVEs
 * earns one — drag a mean somewhere no actual repository sits. The median is a
 * score some real project has.
 */
export function median(scores: number[]): number {
  if (scores.length === 0) return 0
  const sorted = [...scores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Summarise a set of scores, or null when there are too few to summarise.
 *
 * The threshold is the percentile's, deliberately: two surfaces drawn from one
 * table must not disagree about whether there is enough data to speak. A median
 * of nine repositories is a coincidence, and saying it out loud on a landing
 * page would make it look like a finding.
 */
export function summarize(scores: number[]): ScanSummary | null {
  if (scores.length < MIN_SAMPLE) return null

  const grades = { ...EMPTY_GRADES }
  for (const score of scores) grades[scoreToGrade(score)]++

  return { count: scores.length, median: median(scores), grades }
}
