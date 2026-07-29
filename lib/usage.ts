import "server-only"
import { supabaseConfig } from "@/lib/share-db"
import { dbRecordUsage } from "@/lib/usage-db"

/**
 * Usage statistics: how much the service is used, by how many people, on which
 * repositories. Nothing else.
 *
 * The deliberate boundary — what a usage event may contain:
 *
 *   ✓ a random per-browser id, the event name, the repository host and
 *     owner/name, a count, and whether it succeeded
 *   ✗ scores, grades, findings, file paths, snippets, IP addresses, user agents,
 *     referrers, or the raw URL as typed
 *
 * The scan report is the user's; the fact that a scan happened is ours. Keeping
 * those apart is the whole design, and `FORBIDDEN_USAGE_FIELDS` below makes it a
 * check rather than a promise.
 *
 * Identity is a random id minted in the browser, never an IP address. An IP is
 * personal data we would then be responsible for, and it is a bad answer anyway:
 * NAT collapses a whole office into one "user" and mobile carriers smear one
 * person across many. A random id means nothing outside our own table, and a
 * cleared browser simply becomes a new visitor — which is the honest reading of
 * "unique users" for a service with no accounts.
 */

/** Header carrying the visitor id. */
export const VISITOR_HEADER = "x-repo-anti-rot-visitor"

/**
 * Value the client sends when the user has switched statistics off. An explicit
 * refusal, not a missing header: absent could equally mean curl, the CLI or a
 * blocked script, and treating those as opt-out would quietly lose real usage.
 */
export const VISITOR_OPT_OUT = "opt-out"

/** Bucket for callers with no id at all — one shared row, not a fresh "user" each time. */
export const VISITOR_ANONYMOUS = "anonymous"

export type UsageEventName = "scan" | "commit-scan" | "share-create" | "share-view"

export interface UsageEvent {
  visitor: string
  event: UsageEventName
  /** repository host, e.g. "github.com" */
  host?: string
  /** "owner/name" */
  repo?: string
  /** how many units of work — commits scanned, repos scanned */
  amount?: number
  ok?: boolean
}

/**
 * Fields that must never appear in a usage row. Enforced rather than remembered:
 * the realistic regression is someone passing a whole report through for
 * convenience, and a name check catches that at the boundary.
 */
export const FORBIDDEN_USAGE_FIELDS = [
  "report",
  "issues",
  "score",
  "grade",
  "evidence",
  "detail",
  "location",
  "ip",
  "userAgent",
  "url",
] as const

export function assertRecordable(ev: Record<string, unknown>): void {
  for (const field of FORBIDDEN_USAGE_FIELDS) {
    if (field in ev) {
      throw new Error(`Refusing to record usage: payload contains "${field}"`)
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The visitor id for a request.
 *
 * The header is attacker-controlled, so it is validated to a UUID shape rather
 * than stored as sent. Without that, a free-text column reachable from the
 * internet is somewhere to write arbitrary content — and a 10 KB "id" would be
 * both a storage problem and a way to smuggle data through our own analytics.
 *
 * Returns null when the caller opted out, meaning: record nothing.
 */
export function visitorFrom(request: Request): string | null {
  const raw = request.headers.get(VISITOR_HEADER)?.trim() ?? ""
  if (raw === VISITOR_OPT_OUT) return null
  return UUID_RE.test(raw) ? raw.toLowerCase() : VISITOR_ANONYMOUS
}

/**
 * Host and owner/name for a repository URL, or null if it does not look like one.
 *
 * The raw URL is never stored. It can carry credentials (`https://user:token@…`),
 * a deep path, or a query string — none of which we want, and the first of which
 * would be a secret sitting in an analytics table. Host plus owner/name answers
 * "which repositories do people scan" and nothing more.
 */
export function repoIdentity(raw: string): { host: string; repo: string } | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null

  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return null
  const owner = segments[0]
  const name = segments[segments.length - 1].replace(/\.git$/i, "")
  if (!owner || !name) return null

  return { host: parsed.hostname.toLowerCase(), repo: `${owner}/${name}` }
}

/**
 * Record one event, best effort.
 *
 * Never awaited by a route and never allowed to throw: statistics are the least
 * important thing happening in any of these requests, and a slow or broken
 * analytics table must not fail somebody's scan. With no Supabase configured
 * this is a no-op, so local development and self-hosting collect nothing.
 */
export function recordUsage(ev: UsageEvent): void {
  if (!ev.visitor) return
  const cfg = supabaseConfig()
  if (!cfg) return

  const row = {
    visitor: ev.visitor,
    event: ev.event,
    host: ev.host ?? null,
    repo: ev.repo ?? null,
    amount: Math.max(0, Math.floor(ev.amount ?? 1)),
    ok: ev.ok ?? null,
  }
  assertRecordable(row)

  void dbRecordUsage(cfg, row).catch(() => {
    /* analytics must never be load-bearing */
  })
}

/** Convenience: resolve the visitor and record a repository-shaped event. */
export function recordRepoUsage(
  request: Request,
  event: UsageEventName,
  url: string,
  extra: { amount?: number; ok?: boolean } = {},
): void {
  const visitor = visitorFrom(request)
  if (!visitor) return
  const id = repoIdentity(url)
  recordUsage({ visitor, event, host: id?.host, repo: id?.repo, ...extra })
}
