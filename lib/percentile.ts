import "server-only"
import { supabaseConfig } from "@/lib/share-db"
import { dbRecordScanStat, dbScores } from "@/lib/scan-stats-db"
import {
  assertStatRecordable,
  choosePercentile,
  projectScanStat,
  type Cut,
  type Percentile,
  type SizeBucket,
} from "@/lib/scan-stats"

/**
 * Recording a scan result into the distribution, and reading a position out of
 * it.
 *
 * The server-side half of the percentile. Everything decidable without a
 * database lives in `lib/scan-stats.ts` and is tested there; this file is the IO
 * around it.
 */

/**
 * Record one scan's shape, best effort.
 *
 * Never awaited by a route and never allowed to throw — the same rule as
 * `recordUsage`. A statistics table that is slow, full or misconfigured must not
 * cost somebody their scan.
 *
 * `optedOut` is the existing statistics switch, not a new one: a visitor who
 * turned statistics off in settings sends the opt-out marker, and this is one of
 * the things they turned off. There is no separate consent for it because there
 * is no separate collection.
 */
export function recordScanStat(report: unknown, optedOut: boolean): void {
  if (optedOut) return
  const cfg = supabaseConfig()
  if (!cfg) return

  const stat = projectScanStat(report)
  if (!stat) return
  assertStatRecordable(stat as unknown as Record<string, unknown>)

  void dbRecordScanStat(cfg, stat).catch(() => {
    /* analytics must never be load-bearing */
  })
}

/**
 * Where a score stands, or null when there is not enough to say.
 *
 * Cuts are tried narrowest first — language *and* size, then each alone, then
 * everything — and the first with enough rows behind it wins. `choosePercentile`
 * owns that rule; this function owns fetching only what each step needs, so a
 * repository that gets an answer from the narrow cut never triggers the wider
 * queries.
 */
export async function percentileFor(
  score: number,
  opts: { language?: string | null; size?: SizeBucket } = {},
): Promise<Percentile | null> {
  const cfg = supabaseConfig()
  if (!cfg) return null

  const { language, size } = opts
  const plan: { basis: Cut["basis"]; filter: { language?: string | null; size?: SizeBucket } }[] = []
  if (language && size) plan.push({ basis: "language-size", filter: { language, size } })
  if (language) plan.push({ basis: "language", filter: { language } })
  if (size) plan.push({ basis: "size", filter: { size } })
  plan.push({ basis: "all", filter: {} })

  for (const step of plan) {
    let scores: number[]
    try {
      scores = await dbScores(cfg, step.filter)
    } catch {
      return null // a broken stats table is silence, not an error page
    }
    const hit = choosePercentile([{ basis: step.basis, scores }], score)
    if (hit) return hit
  }
  return null
}
