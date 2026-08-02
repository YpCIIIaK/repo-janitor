import "server-only"
import type { SupabaseConfig } from "@/lib/share-db"
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
 *     last_checked_at timestamptz,
 *     last_notified_at timestamptz,
 *     created_at      timestamptz not null default now(),
 *     unsub_token     text not null unique,
 *     manage_token    text not null
 *   );
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
  last_checked_at: string | null
  last_notified_at: string | null
  created_at: string
  unsub_token: string
  manage_token: string
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

function headers(cfg: SupabaseConfig): Record<string, string> {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    "content-type": "application/json",
  }
}

function fromRow(row: DbRow): WatchSubscription | null {
  const g = row.last_grade
  if (g !== "A" && g !== "B" && g !== "C" && g !== "D" && g !== "F") return null
  return {
    id: row.id,
    email: row.email,
    owner: row.owner,
    name: row.name,
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

function toRow(sub: WatchSubscription): DbRow {
  return {
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
}

export async function dbUpsertWatch(
  cfg: SupabaseConfig,
  sub: WatchSubscription,
): Promise<void> {
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        ...headers(cfg),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(toRow(sub)),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Watch upsert failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
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
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
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
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
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
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
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
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
  )
  if (!res.ok) return null
  const rows = (await res.json()) as { manage_token?: string }[]
  const token = Array.isArray(rows) ? rows[0]?.manage_token : undefined
  return typeof token === "string" ? token : null
}

export async function dbDeleteWatch(cfg: SupabaseConfig, id: string): Promise<void> {
  const params = new URLSearchParams({ id: `eq.${id}` })
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
      method: "DELETE",
      headers: { ...headers(cfg), Prefer: "return=minimal" },
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
  const params = new URLSearchParams({ id: `eq.${id}` })
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
      method: "PATCH",
      headers: { ...headers(cfg), Prefer: "return=minimal" },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Watch patch failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
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
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
  )
  if (!res.ok) return []
  const rows = (await res.json()) as DbRow[]
  if (!Array.isArray(rows)) return []
  return rows.map(fromRow).filter((s): s is WatchSubscription => s !== null)
}
