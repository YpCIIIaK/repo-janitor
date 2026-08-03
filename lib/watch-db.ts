import "server-only"
import { restHeaders, withTimeout, type SupabaseConfig } from "@/lib/share-db"
import type { Grade } from "@/lib/mock-data"

/**
 * Supabase backend for watch subscriptions.
 *
 * Plain `fetch` against PostgREST — same shape as share-db / scan-stats-db.
 *
 * Run once in the Supabase SQL editor:
 *
 *   create table public.watch_subscriptions (
 *     id              text primary key,
 *     email           text not null,
 *     owner           text not null,
 *     name            text not null,
 *     repo_url        text not null,
 *     last_grade      text not null,
 *     last_score      smallint not null,
 *     last_sha        text,
 *     last_issue_ids  jsonb not null default '[]'::jsonb,
 *     last_checked_at timestamptz,
 *     last_notified_at timestamptz,
 *     created_at      timestamptz not null default now(),
 *     unsub_token     text not null unique,
 *     manage_token    text not null
 *   );
 *   -- Existing deploys:
 *   alter table public.watch_subscriptions
 *     add column if not exists last_issue_ids jsonb not null default '[]'::jsonb;
 *   create unique index watch_subscriptions_email_repo
 *     on public.watch_subscriptions (email, owner, name);
 *   create index watch_subscriptions_manage on public.watch_subscriptions (manage_token);
 *   create index watch_subscriptions_due on public.watch_subscriptions (last_checked_at nulls first);
 *   alter table public.watch_subscriptions enable row level security;
 *
 * No RLS policies: only the service role reaches the table.
 */

const TABLE = "watch_subscriptions"
const TIMEOUT_MS = 8_000

export type WatchSubscription = {
  id: string
  email: string
  owner: string
  name: string
  repoUrl: string
  lastGrade: Grade
  lastScore: number
  lastSha: string | null
  /** Issue ids from the last successful scan — baseline for regression story. */
  lastIssueIds: string[]
  lastCheckedAt: string | null
  lastNotifiedAt: string | null
  createdAt: string
  unsubToken: string
  manageToken: string
}

type DbRow = {
  id: string
  email: string
  owner: string
  name: string
  repo_url: string
  last_grade: string
  last_score: number
  last_sha: string | null
  last_issue_ids?: unknown
  last_checked_at: string | null
  last_notified_at: string | null
  created_at: string
  unsub_token: string
  manage_token: string
}

function parseIssueIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0)
}



function fromRow(row: DbRow): WatchSubscription | null {
  const g = row.last_grade
  if (g !== "A" && g !== "B" && g !== "C" && g !== "D" && g !== "F") return null
  return {
    id: row.id,
    email: row.email,
    owner: row.owner,
    name: row.name,
    lastIssueIds: parseIssueIds(row.last_issue_ids),
    repoUrl: row.repo_url,
    lastGrade: g,
    lastScore: row.last_score,
    lastSha: row.last_sha,
    lastCheckedAt: row.last_checked_at,
    lastNotifiedAt: row.last_notified_at,
    createdAt: row.created_at,
    unsubToken: row.unsub_token,
    manageToken: row.manage_token,
  }
}

function toRow(sub: WatchSubscription, withIssueIds: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: sub.id,
    email: sub.email,
    owner: sub.owner,
    name: sub.name,
    repo_url: sub.repoUrl,
    last_grade: sub.lastGrade,
    last_score: sub.lastScore,
    last_sha: sub.lastSha,
    last_checked_at: sub.lastCheckedAt,
    last_notified_at: sub.lastNotifiedAt,
    created_at: sub.createdAt,
    unsub_token: sub.unsubToken,
    manage_token: sub.manageToken,
  }
  if (withIssueIds) row.last_issue_ids = sub.lastIssueIds ?? []
  return row
}

/** True when PostgREST rejects an unknown `last_issue_ids` column (migration not applied). */
function missingIssueIdsColumn(status: number, body: string): boolean {
  return (
    status === 400 &&
    /last_issue_ids/i.test(body) &&
    (/Could not find|schema cache|PGRST204/i.test(body) || /column/i.test(body))
  )
}

export async function dbUpsertWatch(
  cfg: SupabaseConfig,
  sub: WatchSubscription,
): Promise<void> {
  async function post(withIssueIds: boolean): Promise<Response> {
    return withTimeout(TIMEOUT_MS, (signal) =>
      fetch(`${cfg.url}/rest/v1/${TABLE}`, {
        method: "POST",
        headers: {
          ...restHeaders(cfg),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(toRow(sub, withIssueIds)),
        signal,
      }),
    )
  }

  let res = await post(true)
  if (!res.ok) {
    const body = await res.text()
    if (missingIssueIdsColumn(res.status, body)) {
      res = await post(false)
      if (!res.ok) {
        throw new Error(`Watch upsert failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
      }
      return
    }
    throw new Error(`Watch upsert failed (${res.status}): ${body.slice(0, 300)}`)
  }
}

export async function dbGetWatchByEmailRepo(
  cfg: SupabaseConfig,
  email: string,
  owner: string,
  name: string,
): Promise<WatchSubscription | null> {
  const params = new URLSearchParams({
    email: `eq.${email}`,
    owner: `eq.${owner}`,
    name: `eq.${name}`,
    select: "*",
    limit: "1",
  })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return null
  const rows = (await res.json()) as DbRow[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  return row ? fromRow(row) : null
}

export async function dbGetWatchByUnsub(
  cfg: SupabaseConfig,
  unsubToken: string,
): Promise<WatchSubscription | null> {
  const params = new URLSearchParams({
    unsub_token: `eq.${unsubToken}`,
    select: "*",
    limit: "1",
  })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return null
  const rows = (await res.json()) as DbRow[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  return row ? fromRow(row) : null
}

export async function dbListByManageToken(
  cfg: SupabaseConfig,
  manageToken: string,
): Promise<WatchSubscription[]> {
  const params = new URLSearchParams({
    manage_token: `eq.${manageToken}`,
    select: "*",
    order: "created_at.desc",
  })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return []
  const rows = (await res.json()) as DbRow[]
  if (!Array.isArray(rows)) return []
  return rows.map(fromRow).filter((s): s is WatchSubscription => s !== null)
}

export async function dbFindManageTokenForEmail(
  cfg: SupabaseConfig,
  email: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    email: `eq.${email}`,
    select: "manage_token",
    limit: "1",
  })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return null
  const rows = (await res.json()) as { manage_token?: string }[]
  const token = Array.isArray(rows) ? rows[0]?.manage_token : undefined
  return typeof token === "string" ? token : null
}

export async function dbDeleteWatch(cfg: SupabaseConfig, id: string): Promise<void> {
  const params = new URLSearchParams({ id: `eq.${id}` })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
      method: "DELETE",
      headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Watch delete failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

export async function dbUpdateWatchCheckpoint(
  cfg: SupabaseConfig,
  id: string,
  patch: {
    lastGrade: Grade
    lastScore: number
    lastSha: string | null
    lastCheckedAt: string
    lastNotifiedAt?: string | null
    lastIssueIds?: string[]
  },
): Promise<void> {
  const body: Record<string, unknown> = {
    last_grade: patch.lastGrade,
    last_score: patch.lastScore,
    last_sha: patch.lastSha,
    last_checked_at: patch.lastCheckedAt,
  }
  if (patch.lastNotifiedAt !== undefined) {
    body.last_notified_at = patch.lastNotifiedAt
  }
  if (patch.lastIssueIds !== undefined) {
    body.last_issue_ids = patch.lastIssueIds
  }
  const params = new URLSearchParams({ id: `eq.${id}` })
  async function patchOnce(payload: Record<string, unknown>): Promise<Response> {
    return withTimeout(TIMEOUT_MS, (signal) =>
      fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
        method: "PATCH",
        headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
        body: JSON.stringify(payload),
        signal,
      }),
    )
  }
  let res = await patchOnce(body)
  if (!res.ok) {
    const errBody = await res.text()
    if (patch.lastIssueIds !== undefined && missingIssueIdsColumn(res.status, errBody)) {
      const { last_issue_ids: _drop, ...without } = body
      res = await patchOnce(without)
      if (!res.ok) {
        throw new Error(
          `Watch checkpoint failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        )
      }
      return
    }
    throw new Error(`Watch checkpoint failed (${res.status}): ${errBody.slice(0, 300)}`)
  }
}

/** Due = never checked, or last check older than `olderThanIso`. */
export async function dbListDueWatches(
  cfg: SupabaseConfig,
  olderThanIso: string,
  limit: number,
): Promise<WatchSubscription[]> {
  // PostgREST: or=(last_checked_at.is.null,last_checked_at.lt.<iso>)
  const params = new URLSearchParams({
    or: `(last_checked_at.is.null,last_checked_at.lt.${olderThanIso})`,
    select: "*",
    order: "last_checked_at.asc.nullsfirst",
    limit: String(limit),
  })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return []
  const rows = (await res.json()) as DbRow[]
  if (!Array.isArray(rows)) return []
  return rows.map(fromRow).filter((s): s is WatchSubscription => s !== null)
}
