import { readServerRepos } from "@/lib/server-store"
import { getShare } from "@/lib/share-store"
import { scopeLine } from "@/lib/verdict"
import { renderHealthCardSvg, type HealthCardData } from "@/lib/health-card"
import type { Grade } from "@/lib/mock-data"
import { parseWidgetOptions } from "@/lib/widget-options"

/**
 * Large SVG health card for READMEs — github-readme-stats size, not a shields strip.
 *
 * Same two sources as `/api/badge`:
 *  - `?token=` — a shared report (the case the Share dialog offers)
 *  - no token — last CI-ingested report for this owner/name
 *
 * A token for a different repository renders the unknown card under the path's
 * name, never the other repo's grade. Discloses grade, score, severity counts
 * and scope — nothing a shared page would not already show, and no findings list.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params
  const { searchParams } = new URL(request.url)
  const opts = parseWidgetOptions(searchParams)

  const wantOwner = decodeURIComponent(owner)
  const wantName = decodeURIComponent(name)
  const id = `${wantOwner}/${wantName}`

  let data: HealthCardData | null = null

  const token = searchParams.get("token")
  if (token) {
    const share = await getShare(token)
    if (
      share &&
      share.report.repo.owner.toLowerCase() === wantOwner.toLowerCase() &&
      share.report.repo.name.toLowerCase() === wantName.toLowerCase()
    ) {
      const r = share.report
      data = {
        owner: wantOwner,
        name: wantName,
        grade: r.grade,
        score: r.score,
        counts: r.counts,
        totalIssues: r.totalIssues,
        generatedAt: r.generatedAt,
        scope: scopeLine(r.profile),
      }
    }
  } else {
    const repo = (await readServerRepos()).find(
      (r) => r.id.toLowerCase() === id.toLowerCase(),
    )
    if (repo) {
      const latest = repo.latest as typeof repo.latest & {
        profile?: { totalFiles?: number; languages?: { language: string; loc: number }[] }
      }
      const issues = latest.issues ?? []
      const counts = { critical: 0, warning: 0, info: 0 }
      for (const i of issues) counts[i.severity]++
      data = {
        owner: wantOwner,
        name: wantName,
        grade: latest.grade as Grade,
        score: latest.score,
        counts,
        totalIssues: issues.length,
        generatedAt: latest.generatedAt,
        scope: scopeLine(latest.profile),
      }
    }
  }

  const svg = renderHealthCardSvg(wantOwner, wantName, data, opts)
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60, must-revalidate",
    },
  })
}
