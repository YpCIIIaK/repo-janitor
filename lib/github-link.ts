/**
 * Build a GitHub "open file" URL from a stored repo + an issue location.
 *
 * The link uses the scan's HEAD commit SHA as the ref when available, producing a
 * frozen permalink: `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<line>`.
 * If no SHA was captured it falls back to the default branch, where the line
 * anchor can drift as the branch moves.
 *
 * Returns null when the location isn't a real file path we can link to (branch
 * refs, globs, repo without a parseable GitHub URL) so the caller can hide the UI.
 */

/** Normalize a git remote/clone URL to `https://github.com/<owner>/<repo>` (or null). */
export function githubBase(url: string | undefined): string | null {
  if (!url) return null
  const m =
    url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i) ||
    url.match(/https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:[/#?].*)?$/i)
  if (!m) return null
  const [, owner, repo] = m
  return `https://github.com/${owner}/${repo}`
}

/** Split an issue `location` into a file path + optional 1-based line number. */
function parseLocation(location: string): { path: string; line?: number } | null {
  // Drop a trailing " @ <sha>" suffix used by history-based findings (secrets).
  const pathPart = location.split(" @ ")[0].trim()
  if (!pathPart) return null
  // Branch refs and globs aren't files we can deep-link to.
  if (pathPart.startsWith("origin/") || pathPart.includes("*")) return null

  const m = pathPart.match(/^(.+?):(\d+)$/)
  if (m) return { path: m[1], line: Number(m[2]) }
  return { path: pathPart }
}

/**
 * Full GitHub URL for an issue's location, or null if it can't be linked.
 * `url` is the stored repo URL; `commit` is the scan's HEAD SHA (preferred ref);
 * `branch` is the repo's default branch (fallback ref).
 */
export function githubFileUrl(
  url: string | undefined,
  commit: string | undefined,
  branch: string | undefined,
  location: string,
): string | null {
  const base = githubBase(url)
  if (!base) return null
  const loc = parseLocation(location)
  if (!loc) return null
  const ref =
    (commit && commit.trim()) || (branch && branch.trim()) || "HEAD"
  const anchor = loc.line ? `#L${loc.line}` : ""
  return `${base}/blob/${ref}/${loc.path}${anchor}`
}
