import { readServerRepos } from "@/lib/server-store"
import { getShare } from "@/lib/share-store"
import { UNKNOWN_GRADE_HEX, gradeHex } from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"
import { formatBadgeMessage } from "@/lib/widget-options"
import { hashSeed } from "@/lib/badge-decor"
import { badgeSvg } from "@/lib/badge-svg"

/**
 * Shields-style SVG health badge for a repo, e.g.
 *   ![rot](https://your-deploy/api/badge/acme/web-dashboard)
 *
 * Renders `repo anti-rot | <grade> <score>` colored by grade. Unknown repos get
 * a neutral "unknown" badge so the image never 404s in a README.
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

/** The shields left-hand text. Fixed: it names the tool, and it is not a setting. */
const BADGE_LABEL = "repo anti-rot"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; name: string }> },
) {
  const { owner, name } = await params
  const { searchParams } = new URL(request.url)

  const wantOwner = decodeURIComponent(owner)
  const wantName = decodeURIComponent(name)
  const id = `${wantOwner}/${wantName}`

  let found: { grade: Grade; score: number } | null = null

  const token = searchParams.get("token")
  if (token) {
    const share = await getShare(token)
    // The token proves the right to read that report; it does not make the
    // report be about whatever repository the URL claims. Owner/name compare
    // case-insensitively — GitHub paths and paste casing often disagree.
    if (
      share &&
      share.report.repo.owner.toLowerCase() === wantOwner.toLowerCase() &&
      share.report.repo.name.toLowerCase() === wantName.toLowerCase()
    ) {
      found = { grade: share.report.grade, score: share.report.score }
    }
  } else {
    const repo = (await readServerRepos()).find(
      (r) => r.id.toLowerCase() === id.toLowerCase(),
    )
    if (repo) found = { grade: repo.latest.grade, score: repo.latest.score }
  }

  const message = found ? formatBadgeMessage(found.grade, found.score) : "unknown"
  const color = found ? gradeHex(found.grade) : UNKNOWN_COLOR

  // The OS reduced-motion preference does not reach an SVG inside an <img>, so
  // the badge takes an explicit opt-out that a README author can paste.
  const animate = searchParams.get("motion") !== "off"

  const svg = badgeSvg(BADGE_LABEL, message, color, hashSeed(id.toLowerCase()), animate)
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // GitHub Camo caches aggressively; keep origin TTL short. Copied markdown
      // also carries a `v=` bust when the share snapshot updates.
      "Cache-Control": "public, max-age=60, s-maxage=60, must-revalidate",
    },
  })
}
