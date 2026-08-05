/**
 * GitHub profile lookup for the person card — the pure half.
 *
 * Fetching lives in the route; this only reduces GitHub's user payload to the
 * handful of fields the card draws, so it can be tested without a network. Same
 * split as `lib/github-repo.ts`, for the same reason.
 *
 * ## Why this is a projection and not a pass-through
 *
 * GitHub's user object carries far more than a card shows — a dozen URL
 * templates, plan and quota fields on an authenticated read, and `email` and
 * `hireable`, which are things a person set on a profile page and did not ask to
 * have baked into an image that travels. Naming the fields we render means the
 * disclosure cannot widen on its own the next time GitHub adds one.
 *
 * `email` is deliberately absent and should stay absent. It is also the one
 * field somebody will eventually want to feed into the seed — see the note in
 * `lib/person-card.ts` about why that is worse than it looks.
 */

import type { PersonFacts } from "@/lib/person-card"

interface ApiUser {
  login?: unknown
  name?: unknown
  bio?: unknown
  location?: unknown
  company?: unknown
  created_at?: unknown
  public_repos?: unknown
  followers?: unknown
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null
  const clean = v.trim()
  return clean ? clean : null
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null

/** Year out of an ISO timestamp, or null for anything unparseable. */
export function joinedYearOf(createdAt: unknown): number | null {
  const iso = str(createdAt)
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t).getUTCFullYear()
}

/**
 * Reduce GitHub's user payload to what the card renders.
 *
 * Returns null when there is no login — an error body, or a payload that lost
 * its shape. A card of blanks under somebody's name is worse than no card,
 * because it reads as a statement that we know nothing about them rather than
 * as a lookup that failed.
 */
export function projectPerson(raw: unknown): PersonFacts | null {
  const u = (raw ?? {}) as ApiUser
  const login = str(u.login)
  if (!login) return null

  return {
    login,
    name: str(u.name),
    bio: str(u.bio),
    location: str(u.location),
    company: str(u.company),
    joinedYear: joinedYearOf(u.created_at),
    publicRepos: num(u.public_repos),
    followers: num(u.followers),
  }
}

/** The API call the card route makes. */
export function userApiUrl(login: string): string {
  return `https://api.github.com/users/${encodeURIComponent(login)}`
}

// ---------------------------------------------------------------------------
// The detailed half: what somebody's repositories say about them
// ---------------------------------------------------------------------------

/**
 * How many repositories the stats are computed over.
 *
 * GitHub's search API will not return more than 100 per page, and paging
 * further to sum a number nobody checks is not worth the rate limit. See
 * {@link projectRepoStats} for what that cap does and does not distort.
 */
export const STATS_SAMPLE = 100

/**
 * Repositories owned by `login`, most-starred first.
 *
 * Search rather than `/users/:login/repos`, and the reason matters. That
 * endpoint sorts by created, updated, pushed or name — not by stars. Summing a
 * page of it gives a number that is simply wrong for anyone with more
 * repositories than a page holds, and names whichever repository was touched
 * most recently as their best known, which for a prolific person is usually
 * something they pushed a typo fix to last week.
 *
 * Sorted by stars, the cap stops being a lie: the top result is exactly their
 * most-starred repository however many they have, and a sum of the top hundred
 * misses only the long tail of repositories with almost no stars in them.
 *
 * `fork:false` because a fork's star count belongs to whoever wrote the
 * original. Counting those would let anybody manufacture a huge total by
 * forking popular projects.
 */
export function repoSearchUrl(login: string): string {
  const q = `user:${login} fork:false`
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${STATS_SAMPLE}`
}

export interface RepoStats {
  /** Most common primary language among their most-starred repositories. */
  topLanguage: string | null
  /** Stars across the sample. */
  starsReceived: number | null
  /** True when they have more repositories than the sample covers. */
  starsApproximate: boolean
  /** Name of their most-starred repository, without the owner prefix. */
  bestKnown: string | null
}

interface ApiSearchItem {
  name?: unknown
  language?: unknown
  stargazers_count?: unknown
}

interface ApiSearch {
  total_count?: unknown
  items?: unknown
}

/**
 * Reduce the search result to the three things the detailed card shows.
 *
 * The language is the modal one across the sample rather than across everything
 * somebody owns, which biases it toward what their popular work is written in.
 * That is the intended bias: the card is saying what a person is known for, not
 * auditing their disk.
 *
 * Returns nulls rather than zeros for somebody with no public repositories —
 * "0 stars" is a claim, and an absent row is the truth.
 */
export function projectRepoStats(raw: unknown): RepoStats {
  const body = (raw ?? {}) as ApiSearch
  const items = Array.isArray(body.items) ? (body.items as ApiSearchItem[]) : []

  const none: RepoStats = {
    topLanguage: null,
    starsReceived: null,
    starsApproximate: false,
    bestKnown: null,
  }
  if (items.length === 0) return none

  let stars = 0
  const languages = new Map<string, number>()
  for (const item of items) {
    stars += num(item.stargazers_count) ?? 0
    const lang = str(item.language)
    if (lang) languages.set(lang, (languages.get(lang) ?? 0) + 1)
  }

  let topLanguage: string | null = null
  let best = 0
  for (const [lang, count] of languages) {
    // Ties keep the earlier entry, and items arrive most-starred first, so a tie
    // resolves toward the language of their better-known work.
    if (count > best) {
      best = count
      topLanguage = lang
    }
  }

  const total = num(body.total_count) ?? items.length

  return {
    topLanguage,
    // A person can own repositories nobody has starred; that is a real zero and
    // worth showing, unlike the absent-row case above.
    starsReceived: stars,
    starsApproximate: total > items.length,
    bestKnown: str(items[0]?.name),
  }
}

/**
 * Ready-to-paste markdown, linked to the profile it was built from.
 *
 * Same argument as the hunter badge: a card that travels without a link back to
 * its source is a picture making claims nobody can check.
 */
export function personCardMarkdown(login: string, origin: string): string {
  const card = `${origin.replace(/\/+$/, "")}/api/card/person/${login}`
  return `[![${login}](${card})](https://github.com/${login})`
}
