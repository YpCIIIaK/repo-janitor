/**
 * Badge markdown for a shared report.
 *
 * Pure, and in its own module, because this string is the thing a person pastes
 * into their README and then forgets about for a year. It has to be right the
 * first time: a badge that 404s, or points at the wrong repository, is worse
 * than no badge — it sits at the top of the page telling everyone the project is
 * broken in a way that has nothing to do with the project.
 */

/** `/r/<owner>/<name>/<token>` — the share path the API hands back. */
const SHARE_PATH_RE = /^\/r\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]+)\/?$/

export interface ShareTarget {
  owner: string
  name: string
  token: string
}

/**
 * Take apart a share URL or path. Null when it is not one.
 *
 * Parsed rather than passed alongside so there is a single source of truth: the
 * link the user was just given. Two values that must agree are two values that
 * can disagree.
 */
export function parseSharePath(input: string): ShareTarget | null {
  let path = input
  try {
    // Accept a full URL or a bare path.
    path = new URL(input, "http://x").pathname
  } catch {
    return null
  }
  const m = path.match(SHARE_PATH_RE)
  if (!m) return null
  try {
    return { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]), token: m[3] }
  } catch {
    return null // malformed percent-encoding
  }
}

/** Absolute badge image URL for a share target. */
export function badgeUrl(origin: string, t: ShareTarget): string {
  const path = `/api/badge/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}`
  return `${origin.replace(/\/$/, "")}${path}?token=${encodeURIComponent(t.token)}`
}

/**
 * The markdown to paste: a badge image linking to the full shared report.
 *
 * Clickable on purpose. A bare grade invites "says who?", and the answer should
 * be one click away rather than something the reader has to take on trust.
 */
export function badgeMarkdown(origin: string, shareUrl: string): string | null {
  const target = parseSharePath(shareUrl)
  if (!target) return null
  const img = badgeUrl(origin, target)
  const href = `${origin.replace(/\/$/, "")}/r/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/${target.token}`
  return `[![Repo Anti-Rot](${img})](${href})`
}
