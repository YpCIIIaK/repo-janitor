import { categoryLabels, type Grade, type Issue, type IssueCategory, type Severity } from "@/lib/mock-data"

/**
 * Client-side mirror of the core engine's scoring (packages/core/src/engine.ts).
 *
 * Kept in sync deliberately: when issues are snoozed in the UI the score must be
 * recomputed in the browser, so we need the exact same weights/rounding the
 * scanner used. If the engine weights change, change them here too.
 */
export type SeverityWeights = Record<Severity, number>

/** Built-in defaults — must mirror the engine (packages/core/src/config.ts). */
export const DEFAULT_WEIGHTS: SeverityWeights = { critical: 10, warning: 3, info: 0.25 }

/**
 * Per-tier penalty caps — must mirror the engine (packages/core/src/engine.ts).
 * Below the cap the penalty is exactly linear, so the cap only affects pile-ups.
 */
export const SEVERITY_PENALTY_CAP: SeverityWeights = { critical: Infinity, warning: 40, info: 8 }

export interface SeverityPenalty {
  severity: Severity
  count: number
  /** Points this tier actually subtracted, after its cap. */
  penalty: number
  /** True when the cap bit — i.e. more findings would cost nothing further. */
  capped: boolean
}

/**
 * Per-tier penalty, in the exact terms the score is computed from.
 *
 * `computeScore` is defined in terms of this rather than repeating the
 * arithmetic, so the number shown to the user and the number that made the grade
 * cannot drift apart.
 */
export function penaltyBreakdown(
  issues: Issue[],
  weights: SeverityWeights = DEFAULT_WEIGHTS,
): SeverityPenalty[] {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++

  return (["critical", "warning", "info"] as const).map((severity) => {
    // Mirrors the engine: a cap never clips a single finding below its own weight.
    const cap = Math.max(SEVERITY_PENALTY_CAP[severity], weights[severity])
    const raw = counts[severity] * weights[severity]
    return {
      severity,
      count: counts[severity],
      penalty: Math.min(raw, cap),
      capped: raw > cap,
    }
  })
}

/** 0–100: start at 100, subtract each severity tier's penalty (count * weight,
 * capped per tier), round, clamp to 0. */
export function computeScore(issues: Issue[], weights: SeverityWeights = DEFAULT_WEIGHTS): number {
  const penalty = penaltyBreakdown(issues, weights).reduce((sum, p) => sum + p.penalty, 0)
  return Math.max(0, Math.round(100 - penalty))
}

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A"
  if (score >= 75) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}

export interface CategoryScore {
  category: IssueCategory
  label: string
  score: number
  grade: Grade
  count: number
}

/**
 * Per-category sub-scores: each scanner category graded independently (starts at
 * 100, penalised only by ITS findings). Only categories with findings are
 * returned — a clean category is implicitly A and would just be noise. Sorted
 * worst-first so the area dragging the repo down surfaces at the top.
 */
export function categoryScores(issues: Issue[], weights: SeverityWeights = DEFAULT_WEIGHTS): CategoryScore[] {
  const byCat = new Map<IssueCategory, Issue[]>()
  for (const issue of issues) {
    const list = byCat.get(issue.category)
    if (list) list.push(issue)
    else byCat.set(issue.category, [issue])
  }

  return [...byCat.entries()]
    .map(([category, list]) => {
      const score = computeScore(list, weights)
      return { category, label: categoryLabels[category], score, grade: scoreToGrade(score), count: list.length }
    })
    .sort((a, b) => a.score - b.score || b.count - a.count)
}
