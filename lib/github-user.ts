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
