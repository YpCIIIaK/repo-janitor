import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Dead Links scanner ⭐.
 *
 * Checks the EXTERNAL http(s) links a repository publishes and reports the ones
 * that no longer resolve. Sibling to {@link brokenDocLinksScanner}, which only
 * handles relative paths inside the repo and deliberately skips anything with a
 * scheme; between them every link in the project is covered.
 *
 * Two things widen the net beyond that scanner:
 *  - links are collected from markdown, `package.json` metadata (`homepage`,
 *    `repository`, `bugs`, `funding`) and `//`-style code comments, not markdown
 *    alone — a dead link in a comment pointing at the RFC that explains the
 *    workaround below it is exactly the rot this tool exists to find;
 *  - a URL is fetched once no matter how many files mention it.
 *
 * Only URLs the repository itself published are requested, one HEAD each, with a
 * hard cap. Anything that looks like an example, a placeholder or a private
 * address is skipped rather than requested — see {@link isCheckable}.
 *
 * Needs `ctx.headUrl`. Without it the scanner is a no-op rather than a guess:
 * reporting a link as dead because we could not check it would be worse than
 * saying nothing.
 */

const MD_RE = /\.(md|mdx|markdown)$/i
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py|go|rs|rb|php|java|kt|swift|cs)$/i
const SKIP_PATH_RE = /(^|\/)(?:node_modules|vendor|third_party|dist|build|out|\.next)\//i
/**
 * Test files are excluded outright. Their URLs are fixtures — invented hosts and
 * invented paths that are supposed to be fake — so every one of them would be
 * reported as dead, and correctly checking them would mean firing requests at
 * addresses the author never intended anyone to visit.
 */
const TEST_RE =
  /(^|\/)(?:__tests__|tests?|specs?|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go|rb)$/i

/** Ceiling on requests per scan, so a link-heavy repo cannot become a crawler. */
const MAX_REQUESTS = 60
const MAX_ISSUES = 40
/** Requests in flight. Deliberately low: politeness to the hosts, not throughput. */
const CONCURRENCY = 4

const URL_RE = /https?:\/\/[^\s<>"'`)\]}\\]+/g

/**
 * Hosts and shapes that must never be requested.
 *
 * Documentation is full of URLs that are meant to be illegitimate — `example.com`
 * is reserved by RFC 2606 precisely for this. Requesting a placeholder wastes a
 * request and reporting it as dead is a false positive by construction.
 *
 * Private and loopback addresses are excluded for a stronger reason: the scanner
 * runs on a server, and a URL taken from a scanned repository must never be able
 * to make that server issue requests into its own network. That is server-side
 * request forgery, and the fact that the URL arrived via a git clone rather than
 * a form field does not make it safer.
 */
const SKIP_HOST_RE =
  /^(?:localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|[^.]*\.local$|[^.]*\.internal$|[^.]*\.test$|[^.]*\.invalid$|[^.]*\.example$|example\.(?:com|org|net)$|.*\.example\.(?:com|org|net)$)/i

/**
 * Placeholder segments authors leave in template URLs.
 *
 * `${` earns its place from a dogfood run: a URL built in source —
 * `https://api.github.com/repos/${owner}/${name}` — is a template, and the
 * extractor happily read it as a literal address ending in `${owner`. Requesting
 * that is guaranteed to 404 and reporting it is guaranteed to be wrong.
 */
const PLACEHOLDER_RE =
  /\{\{|\}\}|\$\{|%[sdv]\b|<[a-z-]+>|\bYOUR[_-]|\bowner\/repo\b|\byour-/i

function stripTrailingPunctuation(url: string): string {
  // Markdown and prose leave punctuation glued to the end: "see https://example.com."
  // Emphasis markers count: `[text](https://example.com)**` is a real shape.
  return url.replace(/[.,;:!?'"*_)]+$/, "")
}

/**
 * Should this URL be requested at all?
 *
 * Returns false for anything unparseable, non-http, private, reserved or clearly
 * a placeholder. Erring towards "skip" is correct here: a missed dead link is a
 * gap, a requested private address is a security problem.
 */
export function isCheckable(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false
  if (SKIP_HOST_RE.test(u.hostname)) return false
  // A bare IP literal has no business in published documentation and may be
  // internal in ways the host pattern above cannot enumerate.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false
  if (PLACEHOLDER_RE.test(raw)) return false
  return true
}

/**
 * Pull http(s) URLs out of a file's text, cleaned of trailing punctuation.
 *
 * A match that stops dead at `<` was cut short by an angle-bracket placeholder,
 * and what survives is not a URL anyone wrote. `PLACEHOLDER_RE` cannot save this
 * one: `URL_RE` excludes `<`, so by the time the check runs the placeholder has
 * already been amputated. This repository's own README supplied the proof —
 * `https://…/api/card/<owner>/<name>?token=<token>` was extracted as
 * `https://…/api/card/`, requested, and reported as a 404. Four of them, in the
 * section that tells people how to install the badge.
 */
export function extractUrls(text: string): string[] {
  return extractUrlsWithLines(text).map((u) => u.url)
}

/**
 * The same extraction, carrying line numbers for the markdown path.
 *
 * One function rather than two: the markdown reader used to inline its own
 * `matchAll(URL_RE)`, which is why the placeholder bug above existed there and
 * nowhere else. A rule that lives in two places is a rule that holds in one.
 */
export function extractUrlsWithLines(text: string): { url: string; line: number }[] {
  const out: { url: string; line: number }[] = []
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0
    if (text[at + m[0].length] === "<") continue
    const cleaned = stripTrailingPunctuation(m[0])
    if (cleaned) out.push({ url: cleaned, line: lineAt(text, at) })
  }
  return out
}

/**
 * URLs written in a source file's COMMENTS, with their line numbers.
 *
 * Only comments, never code. A URL in a string literal is nearly always an API
 * endpoint the program calls, and requesting a bare API base returns 404 without
 * anything being broken. A URL in a comment
 * is a pointer for a human to follow, which is precisely the thing that rots.
 *
 * Exported for tests: this distinction is the difference between a useful
 * scanner and one nobody trusts.
 */
export function commentUrls(content: string): { url: string; line: number }[] {
  const out: { url: string; line: number }[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    let commentPart: string | null = null

    if (trimmed.startsWith("*") || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      // Whole-line comment, including the continuation lines of a /** … */ block.
      commentPart = trimmed
    } else {
      // Trailing comment. `//` inside a URL ("https://") must not be mistaken for
      // one, so the search starts past any scheme on the line.
      const idx = line.indexOf("//", line.indexOf("://") + 3)
      if (idx !== -1) commentPart = line.slice(idx)
    }

    if (!commentPart) continue
    for (const url of extractUrls(commentPart)) out.push({ url, line: i + 1 })
  }

  return out
}

/** package.json fields that hold a URL people follow. */
function manifestUrls(json: unknown): string[] {
  if (!json || typeof json !== "object") return []
  const j = json as Record<string, unknown>
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(...extractUrls(v))
    else if (v && typeof v === "object") {
      for (const inner of Object.values(v as Record<string, unknown>))
        if (typeof inner === "string") out.push(...extractUrls(inner))
    }
  }
  push(j.homepage)
  push(j.repository)
  push(j.bugs)
  push(j.funding)
  return out
}

interface Mention {
  file: string
  line: number
}

/** 1-based line number of a string index. */
function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i])
    }
  })
  await Promise.all(runners)
  return results
}

export const deadLinksScanner: Scanner = {
  id: "dead-links",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const headUrl = ctx.headUrl
    if (!headUrl) return []

    // url -> where it was first seen. First mention only: a link repeated in
    // twelve files is one broken link, and listing it twelve times buries the
    // rest of the report.
    const seen = new Map<string, Mention>()

    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (SKIP_PATH_RE.test(norm) || TEST_RE.test(norm)) continue

      const isMd = MD_RE.test(norm)
      const isCode = CODE_RE.test(norm)
      const isManifest = norm === "package.json" || norm.endsWith("/package.json")
      if (!isMd && !isCode && !isManifest) continue

      const text = await ctx.readFile(file)
      if (!text || !text.includes("http")) continue

      if (isManifest) {
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          continue
        }
        for (const url of manifestUrls(json)) {
          if (!isCheckable(url) || seen.has(url)) continue
          const idx = text.indexOf(url)
          seen.set(url, { file: norm, line: idx === -1 ? 1 : lineAt(text, idx) })
        }
        continue
      }

      // Markdown is prose end to end; source files contribute comments only.
      const found: { url: string; line: number }[] = isMd
        ? extractUrlsWithLines(text)
        : commentUrls(text)

      for (const { url, line } of found) {
        if (!isCheckable(url) || seen.has(url)) continue
        seen.set(url, { file: norm, line })
        if (seen.size >= MAX_REQUESTS) break
      }
      if (seen.size >= MAX_REQUESTS) break
    }

    const targets = [...seen.entries()].slice(0, MAX_REQUESTS)
    const checked = await mapPool(targets, CONCURRENCY, async ([url, where]) => {
      const res = await headUrl(url)
      return { url, where, res }
    })

    const issues: Issue[] = []
    for (const { url, where, res } of checked) {
      if (issues.length >= MAX_ISSUES) break

      // Unreachable: DNS failed, connection refused, or it timed out.
      if (res === null) {
        issues.push({
          id: `deadlink-unreachable-${url}`,
          category: "hygiene",
          severity: "warning",
          title: `Unreachable link → ${url}`,
          location: `${where.file}:${where.line}`,
          ageDays: 0,
          detail:
            `${where.file} links to ${url}, which could not be reached at all — the domain does not ` +
            "resolve, refused the connection, or timed out. That usually means the site is gone " +
            "rather than moved, so the link needs replacing rather than updating. Worth " +
            "double-checking by hand: a single failed request is not proof of a permanent outage.",
          evidence: url,
        })
        continue
      }

      // 404/410 are the unambiguous ones. A 401/403 means the page exists but
      // wants credentials, and 5xx is the server having a bad day — neither is
      // the repository's bug, so neither is reported.
      if (res.status === 404 || res.status === 410) {
        issues.push({
          id: `deadlink-${res.status}-${url}`,
          category: "hygiene",
          severity: "warning",
          title: `Dead link (${res.status}) → ${url}`,
          location: `${where.file}:${where.line}`,
          ageDays: 0,
          detail:
            `${where.file} links to ${url}, which returns HTTP ${res.status}. The page is gone; ` +
            "update the link to its new home or remove it.",
          evidence: url,
        })
      }
    }

    return issues
  },
}
