import { NextResponse } from "next/server"
import { bearerToken, safeEqual } from "@/lib/api-auth"
import { supabaseConfig } from "@/lib/share-db"
import { dbUsageRows, STATS_ROW_LIMIT } from "@/lib/usage-db"
import { aggregateUsage } from "@/lib/usage-stats"
import { readEnv } from "@/lib/env"

/**
 * Aggregate usage statistics for the operator.
 *
 *   GET /api/stats?days=30   Authorization: Bearer <REPO_ANTI_ROT_READ_TOKEN>
 *
 * Auth is REQUIRED here, unlike `/api/reports` where an unset token merely leaves
 * the endpoint open for local development. `checkBearer` is deliberately not used
 * for that reason: its "unset means disabled" rule is right for a route that
 * serves your own reports and wrong for one that serves everybody's activity. An
 * operator who forgets the variable gets 503, not a public feed of who scanned
 * what.
 *
 * The response contains counts only — no report contents, and no visitor ids,
 * which are counted and then discarded rather than listed.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_DAYS = 30
const MAX_DAYS = 365

export async function GET(request: Request) {
  const expected = readEnv("REPO_ANTI_ROT_READ_TOKEN")
  if (!expected) {
    return NextResponse.json(
      { error: "Statistics are disabled: set REPO_ANTI_ROT_READ_TOKEN to enable this endpoint." },
      { status: 503 },
    )
  }
  if (!safeEqual(bearerToken(request), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cfg = supabaseConfig()
  if (!cfg) {
    return NextResponse.json(
      { error: "No usage store configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    )
  }

  const raw = Number(new URL(request.url).searchParams.get("days"))
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(MAX_DAYS, Math.floor(raw))) : DEFAULT_DAYS
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let rows
  try {
    rows = await dbUsageRows(cfg, since)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }

  return NextResponse.json({
    days,
    ...aggregateUsage(rows, since, rows.length >= STATS_ROW_LIMIT),
  })
}
