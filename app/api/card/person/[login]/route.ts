import { isGithubLogin } from "@/lib/hunter"
import { projectPerson, userApiUrl } from "@/lib/github-user"
import { renderPersonCardSvg } from "@/lib/person-card"

/**
 * A card for a person, from their public GitHub profile, e.g.
 *   [![octocat](https://your-deploy/api/card/person/octocat)](https://github.com/octocat)
 *
 * No account, no tier, no history with this project required. See
 * `lib/person-card.ts` for why the handle is the only thing that seeds the look,
 * and `lib/github-user.ts` for which profile fields are rendered.
 *
 * ## What this route is careful about
 *
 * The login arrives from the URL and is validated against GitHub's own username
 * grammar before it is used. Without that gate a crafted path could walk out of
 * `/users/` into another API endpoint entirely and render whatever came back
 * under somebody's name.
 *
 * The card never fails visibly. A README with a broken image in it is worse than
 * one showing a follower count a few minutes stale, so a lookup that fails
 * renders the handle alone — which is a legitimate card, and the reason the
 * generator was built to work from nothing but a handle.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Profiles change at human speed; a stale hour costs nothing, a rate-limit does. */
const TTL_SECONDS = 3600
const FAILURE_TTL_SECONDS = 120

/** GitHub is slow often enough to need a bound; the card degrades instead. */
const TIMEOUT_MS = 4000

async function fetchPerson(login: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-anti-rot-card",
  }
  // Unauthenticated reads allow sixty an hour per IP, which one popular README
  // exhausts. The token needs no scopes — this is public data.
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(userApiUrl(login), {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    return projectPerson(await res.json())
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

  if (!isGithubLogin(login)) {
    return new Response("not a GitHub login", { status: 400 })
  }

  const facts = await fetchPerson(login)
  const theme = searchParams.get("theme") === "light" ? "light" : "dark"
  // `size=wide` gives the README-shaped card. Same data, different shape.
  const layout = searchParams.get("size") === "wide" ? "wide" : "portrait"

  // A failed lookup still renders: the handle is enough, and the sparse card is
  // the honest picture of knowing only that much.
  const svg = renderPersonCardSvg(facts ?? { login }, { theme, layout })
  const ttl = facts ? TTL_SECONDS : FAILURE_TTL_SECONDS

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}, must-revalidate`,
    },
  })
}
