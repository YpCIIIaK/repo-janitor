import type { Grade } from "@/lib/mock-data"

/**
 * Pure drop detection for watch alerts.
 *
 * Mail only when something meaningful got worse — silence on flat / improved
 * scores is what keeps people from unsubscribing.
 */

const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }

export function watchMinDrop(): number {
  const n = Number.parseInt(process.env.WATCH_MIN_DROP ?? "", 10)
  return Number.isFinite(n) && n >= 1 ? n : 3
}

export function isGrade(value: string): value is Grade {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F"
}

export function gradeWorse(prev: Grade, next: Grade): boolean {
  return GRADE_RANK[next] < GRADE_RANK[prev]
}

export type DropVerdict =
  | { dropped: false }
  | { dropped: true; reason: "grade" | "score"; delta: number }

/**
 * Significant drop: letter grade got worse, or score fell by ≥ minDrop points.
 */
export function isSignificantDrop(
  prev: { grade: Grade; score: number },
  next: { grade: Grade; score: number },
  minDrop = watchMinDrop(),
): DropVerdict {
  if (gradeWorse(prev.grade, next.grade)) {
    return { dropped: true, reason: "grade", delta: prev.score - next.score }
  }
  const delta = prev.score - next.score
  if (delta >= minDrop) {
    return { dropped: true, reason: "score", delta }
  }
  return { dropped: false }
}
