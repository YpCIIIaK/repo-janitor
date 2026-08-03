import { NextResponse } from "next/server"
import { supabaseConfig } from "@/lib/share-db"
import { dbScores } from "@/lib/scan-stats-db"
import { summarize } from "@/lib/scan-summary"

/**
 * What everything scanned so far looks like.
 *
 *   GET /api/scan-summary
 *   → { count: 33, median: 70, grades: { A: 6, B: 8, C: 5, D: 7, F: 7 } }
 *   → { count: 0 } when there is not enough to say
 *
 * Public and unauthenticated for the same reason `/api/percentile` is: the
 * answer is an aggregate over a table that holds no repository names, so there
 * is nothing here to attribute to anyone. It takes no parameters at all, which
 * makes that easy to check.
 *
 * A failure is answered with "not enough data" rather than a 500. The landing
 * page renders nothing in that case, and a statistics table having a bad day
 * must not be the first thing a stranger sees.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOTHING = { count: 0 } as const

export async function GET() {
  const cfg = supabaseConfig()
  if (!cfg) return NextResponse.json(NOTHING)

  try {
    const summary = summarize(await dbScores(cfg))
    return NextResponse.json(summary ?? NOTHING)
  } catch {
    return NextResponse.json(NOTHING)
  }
}
