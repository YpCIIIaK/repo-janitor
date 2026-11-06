import scores from "@/lib/benchmark-scores.json"
import { choosePercentile, type Cut, type Percentile, type SizeBucket } from "@/lib/scan-stats"

/**
 * Percentile against the public benchmark corpus (benchmark/stats.mjs writes
 * the sorted score arrays). Used when live scan statistics are missing or too
 * thin, so a report can always say where it stands among real projects.
 */
const CUTS = scores as Record<string, number[]>

export function benchmarkPercentile(
  score: number,
  opts: { language?: string | null; size?: SizeBucket } = {},
  cuts: Record<string, number[]> = CUTS,
): Percentile | null {
  const { language, size } = opts
  const plan: Cut[] = []
  const push = (basis: Cut["basis"], key: string) => {
    if (cuts[key]) plan.push({ basis, scores: cuts[key] })
  }
  if (language && size) push("language-size", `lang:${language}|size:${size}`)
  if (language) push("language", `lang:${language}`)
  if (size) push("size", `size:${size}`)
  push("all", "all")
  const hit = choosePercentile(plan, score)
  return hit ? { ...hit, source: "benchmark" } : null
}
