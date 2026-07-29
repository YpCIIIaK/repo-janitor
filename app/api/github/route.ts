import { NextResponse } from "next/server"
import {
  isValidRepoRef,
  projectRepo,
  type GithubRepo,
} from "@/lib/github-repo"
import { checkRateLimit, clientIp, limitsFromEnv } from "@/lib/scan-limits"

/**
 * Repository lookup and search, proxied to GitHub.
 *
 *   GET /api/github?owner=acme&name=widget   one repository
 *   GET /api/github?q=anti+rot               top matches for a query
 *
 * Proxied rather than called from the browser for two reasons that both matter.
 * GitHub's unauthenticated quota is 60 requests an hour for lookups and 10 a
 * minute for search, counted per IP — from a browser that is the visitor's quota,
 * which breaks for anyone behind a shared address and cannot be cached for the
 * next person. And a server-side call is the only place a token can live, since
 * a token in client JavaScript is simply a published token.
 *
 * The upstream host is a constant here. `owner` and `name` are pattern-checked
 * and URL-encoded before they reach it, so nothing a caller types can steer the
 * request somewhere else — this endpoint makes outbound requests on demand,
 * which is exactly the shape SSRF takes when the host is interpolated.
 */
export const runtime = "nodejs"

const API = "https://api.github.com"
const TIMEOUT_MS = 8_000
const MAX_QUERY = 120
const SEARCH_LIMIT = 6

/** Cache TTL. Stars and descriptions do not move fast; the quota does. */
const TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 500

type Cached = { at: number; status: number; body: unknown }
const cache = new Map<string, Cached>()

function cacheGet(key: string): Cached | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  // Refresh insertion order so the eviction below is least-recently-used.
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: Cached): void {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

async function github(path: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const token = process.env.GITHUB_TOKEN?.trim()
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "repo-anti-rot",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  } finally {
    clearTimeout(timer)
  }
}

/** The search list is a card each, so it gets the same projection treatment. */
function projectSearch(body: unknown): GithubRepo[] {
  const items = (body as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  return items
    .slice(0, SEARCH_LIMIT)
    .map(projectRepo)
    .filter((r): r is GithubRepo => r !== null)
}

export async function GET(request: Request) {
  const limits = limitsFromEnv()
  if (!checkRateLimit(clientIp(request, limits.trustedProxyHops), limits).ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const params = new URL(request.url).searchParams
  const owner = params.get("owner")?.trim() ?? ""
  const name = params.get("name")?.trim() ?? ""
  const q = params.get("q")?.trim() ?? ""

  let key: string
  let path: string
  let mode: "repo" | "search"

  if (owner || name) {
    if (!isValidRepoRef(owner, name)) {
      return NextResponse.json({ error: "Bad repository reference" }, { status: 400 })
    }
    mode = "repo"
    key = `repo:${owner.toLowerCase()}/${name.toLowerCase()}`
    path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  } else if (q) {
    if (q.length > MAX_QUERY) {
      return NextResponse.json({ error: "Query too long" }, { status: 400 })
    }
    mode = "search"
    key = `search:${q.toLowerCase()}`
    // `fork:true` is left off deliberately: a search full of forks of the thing
    // you meant is worse than a short list of originals.
    path = `/search/repositories?q=${encodeURIComponent(q)}&per_page=${SEARCH_LIMIT}&sort=stars&order=desc`
  } else {
    return NextResponse.json({ error: "Provide `owner`+`name` or `q`." }, { status: 400 })
  }

  const cached = cacheGet(key)
  if (cached) {
    return NextResponse.json(cached.body, {
      status: cached.status,
      headers: { "x-cache": "hit" },
    })
  }

  let res: { status: number; body: unknown }
  try {
    res = await github(path)
  } catch {
    return NextResponse.json({ error: "GitHub is unreachable" }, { status: 502 })
  }

  if (res.status === 404) {
    // Cached like any other answer: a mistyped name is exactly the request that
    // arrives repeatedly while somebody edits the box.
    const body = { error: "not-found" }
    cacheSet(key, { at: Date.now(), status: 404, body })
    return NextResponse.json(body, { status: 404 })
  }
  if (res.status === 403 || res.status === 429) {
    // Not cached: the quota resets, and caching would extend the outage past it.
    return NextResponse.json(
      { error: "GitHub rate limit reached. Try again shortly." },
      { status: 503 },
    )
  }
  if (res.status !== 200) {
    return NextResponse.json({ error: `GitHub returned ${res.status}` }, { status: 502 })
  }

  const body =
    mode === "repo" ? { repo: projectRepo(res.body) } : { repos: projectSearch(res.body) }

  if (mode === "repo" && !(body as { repo: GithubRepo | null }).repo) {
    return NextResponse.json({ error: "Unexpected GitHub payload" }, { status: 502 })
  }

  cacheSet(key, { at: Date.now(), status: 200, body })
  return NextResponse.json(body, { headers: { "x-cache": "miss" } })
}
