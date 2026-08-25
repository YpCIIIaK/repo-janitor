import { NextResponse } from "next/server"
import { readMarket, rankMarket, marketSites, type MarketSort } from "@/lib/audit/market"

/**
 * The bounty market, ranked for the dashboard.
 *
 *   GET /api/audit/market?site=cantina&sort=density&repos=1&nokyc=1&q=uni&limit=100
 *
 * No auth: the snapshot is a projection of public bounty listings, the same data
 * the platforms publish. It is served read-only from the file the Python engine
 * writes; this route never scrapes anything itself.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SORTS = new Set<MarketSort>(["density", "reward", "reports"])

export async function GET(request: Request) {
  let all
  try {
    all = await readMarket()
  } catch {
    return NextResponse.json(
      { error: "Market snapshot not found. Run `pnpm --filter @repo-anti-rot/audit-engine market:refresh`." },
      { status: 503 },
    )
  }
  const url = new URL(request.url)
  const sortParam = url.searchParams.get("sort") as MarketSort | null
  const limitParam = Number(url.searchParams.get("limit"))
  const programs = rankMarket(all, {
    site: url.searchParams.get("site") ?? undefined,
    sort: sortParam && SORTS.has(sortParam) ? sortParam : "density",
    reposOnly: url.searchParams.get("repos") === "1",
    noKyc: url.searchParams.get("nokyc") === "1",
    search: url.searchParams.get("q") ?? undefined,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200,
  })
  return NextResponse.json({
    total: all.length,
    shown: programs.length,
    sites: marketSites(all),
    programs,
  })
}
