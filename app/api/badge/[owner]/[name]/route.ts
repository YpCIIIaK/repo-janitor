import { readServerRepos } from "@/lib/server-store"
import { getShare } from "@/lib/share-store"
import { UNKNOWN_GRADE_HEX, gradeHex } from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"
import { formatBadgeMessage, parseWidgetOptions } from "@/lib/widget-options"

/**
 * Shields-style SVG health badge for a repo, e.g.
 *   ![rot](https://your-deploy/api/badge/acme/web-dashboard)
 *
 * Renders `repo anti-rot | <grade> <score>` colored by grade. Unknown repos get
 * a neutral "unknown" badge so the image never 404s in a README. The right-hand
 * label can be overridden with ?label=, and ?style=flat-square squares corners.
 *
 * ## Two sources, because there were two kinds of user and only one was served
 *
 *  - **`?token=` — a shared report.** The token is the same capability that
 *    opens `/r/<owner>/<name>/<token>`, and the badge discloses strictly less
 *    than that page does: a grade and a score, no findings at all.
 *  - **no token — the CI-ingested report**, whatever was last POSTed to
 *    `/api/ingest`.
 *
 * Until the first of those existed, a badge required setting up the GitHub
 * Action and an ingest token, which meant the one person a badge is FOR —
 * somebody who scanned a repository, liked the answer and wanted to show it —
 * could not have one. The product could tell you your repo was rotting and had
 * no way for you to say it was fine.
 *
 * A token whose report is for a different repository renders `unknown` rather
 * than that repository's grade. The path names a repo and a README is where
 * this ends up: serving one project's score under another project's name would
 * make the badge a way to misrepresent, which is worse than not having one.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UNKNOWN_COLOR = UNKNOWN_GRADE_HEX

// Approximate Verdana width per char at 11px — good enough for badge spacing.
function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[iIl.,:;'!|]/.test(ch) ? 3.5 : /[mwMW]/.test(ch) ? 9 : 6.5
  return Math.ceil(w)
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function badgeSvg(label: string, message: string, color: string, square: boolean): string {
  const pad = 6
  const lw = textWidth(label) + pad * 2
  const mw = textWidth(message) + pad * 2
  const total = lw + mw
  const h = 20
  const r = square ? 0 : 3
  const lx = (lw / 2) * 10
  const mx = (lw + mw / 2) * 10
  const lLen = (lw - pad) * 10
  const mLen = (mw - pad) * 10

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <title>${esc(label)}: ${esc(message)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="${h}" rx="${r}" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="${h}" fill="${color}"/>
    <rect width="${total}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
    <text x="${lx}" y="140" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
    <text aria-hidden="true" x="${mx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mLen}">${esc(message)}</text>
    <text x="${mx}" y="140" transform="scale(.1)" textLength="${mLen}">${esc(message)}</text>
  </g>
</svg>`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params
  const { searchParams } = new URL(request.url)
  const opts = parseWidgetOptions(searchParams)
  const square = opts.style === "flat-square"

  const wantOwner = decodeURIComponent(owner)
  const wantName = decodeURIComponent(name)
  const id = `${wantOwner}/${wantName}`

  let found: { grade: Grade; score: number } | null = null

  const token = searchParams.get("token")
  if (token) {
    const share = await getShare(token)
    // The token proves the right to read that report; it does not make the
    // report be about whatever repository the URL claims.
    if (share && share.report.repo.owner === wantOwner && share.report.repo.name === wantName) {
      found = { grade: share.report.grade, score: share.report.score }
    }
  } else {
    const repo = (await readServerRepos()).find((r) => r.id === id)
    if (repo) found = { grade: repo.latest.grade, score: repo.latest.score }
  }

  const message = found
    ? formatBadgeMessage(found.grade, found.score, opts.message)
    : "unknown"
  const color = found ? gradeHex(found.grade) : UNKNOWN_COLOR

  const svg = badgeSvg(opts.label, message, color, square)
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Let CDNs cache briefly but always allow a quick refresh after a new scan.
      "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=600",
    },
  })
}
