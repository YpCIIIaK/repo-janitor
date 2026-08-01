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

function shareHref(origin: string, t: ShareTarget): string {
  const base = origin.replace(/\/$/, "")
  return `${base}/r/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}/${t.token}`
}

/** Absolute badge image URL for a share target (shields strip). */
export function badgeUrl(origin: string, t: ShareTarget): string {
  const path = `/api/badge/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}`
  return `${origin.replace(/\/$/, "")}${path}?token=${encodeURIComponent(t.token)}`
}

/** Absolute large-card image URL for a share target (README plaque). */
export function cardUrl(origin: string, t: ShareTarget): string {
  const path = `/api/card/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}`
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
  return `[![Repo Anti-Rot](${img})](${shareHref(origin, target)})`
}

/**
 * Markdown for the large health card — same link target as the strip badge.
 */
export function cardMarkdown(origin: string, shareUrl: string): string | null {
  const target = parseSharePath(shareUrl)
  if (!target) return null
  const img = cardUrl(origin, target)
  return `[![Repo Anti-Rot](${img})](${shareHref(origin, target)})`
}

/** Default iframe size — matches the compact embed plaque. */
export const EMBED_WIDTH = 420
export const EMBED_HEIGHT = 200

/** Absolute embed page URL for a share target. */
export function embedUrl(origin: string, t: ShareTarget): string {
  const base = origin.replace(/\/$/, "")
  return `${base}/embed/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}/${t.token}`
}

/**
 * HTML iframe snippet for docs / status pages.
 *
 * Not for GitHub READMEs — they strip iframes; use {@link cardMarkdown} there.
 */
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

export function embedSnippet(origin: string, shareUrl: string): string | null {
  const target = parseSharePath(shareUrl)
  if (!target) return null
  const src = embedUrl(origin, target)
  const title = escAttr(`Repo Anti-Rot — ${target.owner}/${target.name}`)
  return `<iframe src="${escAttr(src)}" title="${title}" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" style="border:0;border-radius:12px;overflow:hidden;background:transparent" loading="lazy"></iframe>`
}
