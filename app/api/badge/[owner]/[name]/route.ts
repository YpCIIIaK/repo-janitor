import { readServerRepos } from "@/lib/server-store"
import type { Grade } from "@/lib/mock-data"

/**
 * Shields-style SVG health badge for a repo, e.g.
 *   ![rot](https://your-deploy/api/badge/acme/web-dashboard)
 *
 * Reads the server-ingested report (whatever CI last POSTed to /api/ingest) and
 * renders `repo anti-rot | <grade> <score>` colored by grade. Unknown repos get a
 * neutral "unknown" badge so the image never 404s in a README. The right-hand
 * label can be overridden with ?label=, and ?style=flat-square squares the corners.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Grade → shields color. Healthy greens → amber → red.
const GRADE_COLOR: Record<Grade, string> = {
  A: "#3fb950",
  B: "#4c9a2a",
  C: "#dfb317",
  D: "#fe7d37",
  F: "#e05d44",
}
const UNKNOWN_COLOR = "#9f9f9f"

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
  const label = searchParams.get("label") || "repo anti-rot"
  const square = searchParams.get("style") === "flat-square"

  const id = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`
  const repos = await readServerRepos()
  const repo = repos.find((r) => r.id === id)

  const message = repo ? `${repo.latest.grade} ${repo.latest.score}` : "unknown"
  const color = repo ? GRADE_COLOR[repo.latest.grade] ?? UNKNOWN_COLOR : UNKNOWN_COLOR

  const svg = badgeSvg(label, message, color, square)
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Let CDNs cache briefly but always allow a quick refresh after a new scan.
      "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=600",
    },
  })
}
