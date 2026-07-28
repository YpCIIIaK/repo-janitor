import "server-only"
import type { SharedReport } from "@/lib/share-report"

/**
 * Supabase backend for share links.
 *
 * Spoken to over PostgREST with plain `fetch` rather than through
 * `@supabase/supabase-js`. The whole interaction is "insert one row" and "select
 * one row by primary key" — two requests. Pulling in a client library, its
 * realtime channel, its auth module and its storage module to do that would add
 * more weight than the feature, in a project that grades other people on
 * dependency weight.
 *
 * Table (run once in the Supabase SQL editor):
 *
 *   create table public.shared_reports (
 *     token       text primary key,
 *     created_at  timestamptz not null default now(),
 *     report      jsonb not null
 *   );
 *   alter table public.shared_reports enable row level security;
 *
 * No RLS policies are added on purpose: with none, anon and authenticated roles
 * can do nothing at all, and only the service role — which bypasses RLS and
 * never leaves the server — can read or write. The share token is the capability;
 * the database is not a second, weaker gate.
 */

const TABLE = "shared_reports"
const TIMEOUT_MS = 8_000

export interface SupabaseConfig {
  url: string
  serviceKey: string
}

/**
 * Read the Supabase configuration, or null when unset.
 *
 * Null is not an error: with no configuration the store falls back to the
 * filesystem, so local development and self-hosting need no account.
 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "")
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) return null
  return { url, serviceKey }
}

function headers(cfg: SupabaseConfig): Record<string, string> {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    "content-type": "application/json",
  }
}

/** Abort rather than hang: a slow database must not hold a request open forever. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export interface DbShare {
  token: string
  createdAt: string
  report: SharedReport
}

export async function dbPutShare(
  cfg: SupabaseConfig,
  token: string,
  report: SharedReport,
): Promise<void> {
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...headers(cfg), Prefer: "return=minimal" },
      body: JSON.stringify({ token, report }),
      signal,
    }),
  )
  if (!res.ok) {
    // Surface the database's own message: "relation does not exist" is the
    // difference between a misconfigured deploy and a broken feature, and
    // swallowing it turns a five-minute fix into an afternoon.
    throw new Error(`Supabase insert failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

export async function dbGetShare(
  cfg: SupabaseConfig,
  token: string,
): Promise<DbShare | null> {
  const params = new URLSearchParams({
    token: `eq.${token}`,
    select: "token,created_at,report",
    limit: "1",
  })

  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
  )
  if (!res.ok) return null

  const rows = (await res.json()) as { token: string; created_at: string; report: SharedReport }[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row?.report) return null
  return { token: row.token, createdAt: row.created_at, report: row.report }
}
