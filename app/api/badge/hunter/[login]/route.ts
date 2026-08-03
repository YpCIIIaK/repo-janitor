import { badgeSvg } from "@/lib/badge-svg"
import { hashSeed } from "@/lib/badge-decor"
import { hunterApiUrl, isGithubLogin } from "@/lib/hunter"

/**
 * Badge for confirmed false-positive reports, e.g.
 *   [![false positives found](https://your-deploy/api/badge/hunter/octocat)](…)
 *
 * Counts issues on this project labelled `false-positive: confirmed` and
 * authored by `login`. See `lib/hunter.ts` for why it counts confirmations
 * rather than reports, and why the number lives on GitHub rather than in our
 * database.
 *
 * ## What this route is careful about
 *
 * The login comes from the URL, so it is validated against GitHub's own username
 * grammar before it goes anywhere near the search query. Without that gate a
 * crafted path could inject its own qualifiers and count somebody else's issues
 * under a stranger's name — a badge that lies on request.
 *
 * The badge never fails visibly. GitHub search is rate-limited and occasionally
 * slow, and a README with a broken image in it is worse than one showing a
 * number a few minutes stale, so any failure renders `unknown` and is cached
 * briefly rather than surfacing an error.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BADGE_LABEL = "false positives found"

/** Mint green when there is something to show; grey for none and for unknown. */
const FOUND_COLOR = "#3fb950"
const NEUTRAL_COLOR = "#8b949e"

/** Confirmations move at human speed; a stale minute costs nothing, a rate-limit does. */
const TTL_SECONDS = 3600
const FAILURE_TTL_SECONDS = 120

/** GitHub search is slow often enough to need a bound; the badge degrades instead. */
const TIMEOUT_MS = 4000

async function confirmedCount(login: string): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-anti-rot-badge",
  }
  // Unauthenticated search allows ten requests a minute, which one popular
  // README exhausts. The token needs no scopes — this is public data.
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(hunterApiUrl(login), {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { total_count?: unknown }
    return typeof body.total_count === "number" ? body.total_count : null
  } catch {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ login: string }> },
) {
  const { login: raw } = await params
  const login = decodeURIComponent(raw)
  const { searchParams } = new URL(request.url)

  const count = isGithubLogin(login) ? await confirmedCount(login) : null

  const message = count === null ? "unknown" : String(count)
  const color = count ? FOUND_COLOR : NEUTRAL_COLOR

  // The OS reduced-motion preference does not reach an SVG inside an <img>, so
  // the badge takes an explicit opt-out that a README author can paste.
  const animate = searchParams.get("motion") !== "off"

  const svg = badgeSvg(BADGE_LABEL, message, color, hashSeed(login.toLowerCase()), animate)
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${
        count === null ? FAILURE_TTL_SECONDS : TTL_SECONDS
      }, s-maxage=${count === null ? FAILURE_TTL_SECONDS : TTL_SECONDS}, must-revalidate`,
    },
  })
}
