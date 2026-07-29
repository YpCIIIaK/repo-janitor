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

/**
 * What each individual finding costs the score, keyed by issue id.
 *
 * Below a tier's cap this is simply its weight. Above the cap the tier's total
 * is fixed, so the findings in it *share* that total — twenty info notes past
 * an 8-point cap cost 0.4 each, not 0.25. Any other split would be a number
 * that does not add up: the per-finding costs have to sum to the tier penalty,
 * because that is the only reading of "this is what it costs you" that survives
 * someone checking the arithmetic.
 *
 * A consequence worth knowing rather than hiding: inside a capped tier, fixing
 * one finding does not raise the score by its listed cost — the remaining ones
 * absorb it. The UI says so where it shows these numbers.
 */
export function issueCosts(
  issues: Issue[],
  weights: SeverityWeights = DEFAULT_WEIGHTS,
): Map<string, number> {
  const byTier = new Map(penaltyBreakdown(issues, weights).map((p) => [p.severity, p]))
  const costs = new Map<string, number>()
  for (const issue of issues) {
    const tier = byTier.get(issue.severity)
    costs.set(issue.id, tier && tier.count > 0 ? tier.penalty / tier.count : 0)
  }
  return costs
}

/** Points each category is responsible for, worst first. */
export function categoryCosts(
  issues: Issue[],
  weights: SeverityWeights = DEFAULT_WEIGHTS,
): { category: IssueCategory; label: string; cost: number; count: number }[] {
  const costs = issueCosts(issues, weights)
  const byCat = new Map<IssueCategory, { cost: number; count: number }>()
  for (const issue of issues) {
    const acc = byCat.get(issue.category) ?? { cost: 0, count: 0 }
    acc.cost += costs.get(issue.id) ?? 0
    acc.count++
    byCat.set(issue.category, acc)
  }
  return [...byCat.entries()]
    .map(([category, { cost, count }]) => ({
      category,
      label: categoryLabels[category],
      cost,
      count,
    }))
    .sort((a, b) => b.cost - a.cost || b.count - a.count)
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
