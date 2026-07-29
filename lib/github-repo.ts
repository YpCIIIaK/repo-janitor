/**
 * GitHub repository lookup — the pure half.
 *
 * Parsing what someone typed, and reducing GitHub's API payload to the handful
 * of fields the preview card shows. No fetching here, so it can be tested
 * without a network and reused on both sides of the wire.
 */

/** What the preview card renders. Deliberately small — see `projectRepo`. */
export interface GithubRepo {
  owner: string
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  cloneUrl: string
  defaultBranch: string
  stars: number
  forks: number
  openIssues: number
  /** Primary language, or null for repositories GitHub cannot classify. */
  language: string | null
  /** SPDX id, e.g. "MIT". Null when unlicensed — which is worth showing. */
  license: string | null
  topics: string[]
  /** Last push, ISO. The number that says whether anyone still works on this. */
  pushedAt: string | null
  createdAt: string | null
  archived: boolean
  fork: boolean
  private: boolean
  /** Repository size in KB, as GitHub reports it. */
  sizeKb: number
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

/** True for an owner/name pair GitHub could actually have. */
export function isValidRepoRef(owner: string, name: string): boolean {
  return OWNER_RE.test(owner) && NAME_RE.test(name)
}

/**
 * Read `owner/name` out of whatever the user typed, or null.
 *
 * Accepts a full URL, an `scp`-style git address, and the bare `owner/name`
 * shorthand people actually type. Anything else returns null, and the caller
 * treats the text as a search query instead — guessing at a malformed URL would
 * mean showing a card for a repository nobody asked about.
 */
export function parseRepoRef(raw: string): { owner: string; name: string } | null {
  const text = raw.trim()
  if (!text) return null

  let path: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    // Only github.com. Another host may well be a valid git remote, but this
    // card is filled from GitHub's API and would silently describe the wrong
    // project if some other forge happened to host the same owner/name.
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null
    path = url.pathname
  } else if (text.startsWith("git@")) {
    const at = text.indexOf(":")
    if (at === -1) return null
    if (!/^git@(?:www\.)?github\.com$/i.test(text.slice(0, at))) return null
    path = text.slice(at + 1)
  } else {
    path = text
  }

  const segments = path.split("/").filter(Boolean)
  if (segments.length < 2) return null
  const owner = segments[0]
  const name = segments[1].replace(/\.git$/i, "")
  return isValidRepoRef(owner, name) ? { owner, name } : null
}

/** True when the text looks like a search query rather than a repository address. */
export function looksLikeQuery(raw: string): boolean {
  const text = raw.trim()
  if (text.length < 2) return false
  return parseRepoRef(text) === null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)
}

interface ApiRepo {
  name?: unknown
  full_name?: unknown
  owner?: { login?: unknown }
  description?: unknown
  html_url?: unknown
  clone_url?: unknown
  default_branch?: unknown
  stargazers_count?: unknown
  forks_count?: unknown
  open_issues_count?: unknown
  language?: unknown
  license?: { spdx_id?: unknown } | null
  topics?: unknown
  pushed_at?: unknown
  created_at?: unknown
  archived?: unknown
  fork?: unknown
  private?: unknown
  size?: unknown
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * Reduce GitHub's repository payload to what the card shows.
 *
 * A projection rather than a pass-through: GitHub returns well over a hundred
 * fields, including a dozen URL templates and the owner's full profile. Handing
 * all of that to the browser would ship data nobody renders and quietly widen
 * what this endpoint discloses every time GitHub adds a field.
 *
 * Returns null for a payload that is not a repository (an error body, a rename
 * redirect that lost its shape) rather than a card full of blanks.
 */
export function projectRepo(raw: unknown): GithubRepo | null {
  const r = (raw ?? {}) as ApiRepo
  const fullName = str(r.full_name)
  const owner = str(r.owner?.login)
  const name = str(r.name)
  if (!fullName || !owner || !name) return null

  const license = r.license && typeof r.license === "object" ? str(r.license.spdx_id) : null

  return {
    owner,
    name,
    fullName,
    description: str(r.description),
    htmlUrl: str(r.html_url) ?? `https://github.com/${fullName}`,
    cloneUrl: str(r.clone_url) ?? `https://github.com/${fullName}.git`,
    defaultBranch: str(r.default_branch) ?? "main",
    stars: num(r.stargazers_count),
    forks: num(r.forks_count),
    openIssues: num(r.open_issues_count),
    language: str(r.language),
    // GitHub reports "NOASSERTION" for a licence file it cannot identify. That
    // is not a licence name, and showing it as one would be worse than blank.
    license: license && license !== "NOASSERTION" ? license : null,
    topics: Array.isArray(r.topics)
      ? r.topics.filter((t): t is string => typeof t === "string").slice(0, 8)
      : [],
    pushedAt: str(r.pushed_at),
    createdAt: str(r.created_at),
    archived: r.archived === true,
    fork: r.fork === true,
    private: r.private === true,
    sizeKb: num(r.size),
  }
}

/** Compact count for a card: 1234 → "1.2k", 1234567 → "1.2M". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`
  }
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}M`
}
