import "server-only"
import type { SharedReport } from "@/lib/share-report"
import { repoKeyOf } from "@/lib/share-keys"

/**
 * Supabase backend for share links.
 *
 * Spoken to over PostgREST with plain `fetch` rather than through
 * `@supabase/supabase-js`. The whole interaction is a handful of REST calls —
 * pulling in a client library for that would add more weight than the feature.
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
 * never leaves the server — can read or write.
 *
 * Stable shares (one URL per repo, updatable snapshot) store a v2 envelope
 * inside the existing `report` jsonb column — no ALTER TABLE required, which
 * matters on a free Render box where the operator may already have the table
 * and no migration workflow. Legacy rows (bare SharedReport) still read; they
 * cannot be managed until replaced by a new publish.
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

/**
 * PostgREST auth headers for the service role.
 *
 * Lives here, with `supabaseConfig`, because every other `*-db.ts` module
 * already imports from this one. It was copied into all five of them until this
 * project's own duplicate-code scanner reported the twelve repeated lines —
 * byte-identical, differing only in the timeout constant each one closed over.
 * That is the exact drift the finding warns about: five places to forget when
 * an auth header changes.
 */
export function restHeaders(cfg: SupabaseConfig): Record<string, string> {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    "content-type": "application/json",
  }
}

/**
 * Run a fetch under an abort deadline.
 *
 * The timeout is a parameter rather than a constant because the callers do not
 * agree on it: the read paths use 5s and the write paths 8s. Collapsing them to
 * one number would have been a behaviour change smuggled in as a refactor.
 */
export async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export interface DbShare {
  token: string
  createdAt: string
  updatedAt: string
  repoKey: string
  manageKeyHash: string
  report: SharedReport
}

/** Envelope written into the `report` jsonb column for manageable shares. */
export interface DbReportEnvelopeV2 {
  v: 2
  manageKeyHash: string
  repoKey: string
  updatedAt: string
  body: SharedReport
}

export function packDbReport(share: {
  manageKeyHash: string
  repoKey: string
  updatedAt: string
  report: SharedReport
}): DbReportEnvelopeV2 {
  return {
    v: 2,
    manageKeyHash: share.manageKeyHash,
    repoKey: share.repoKey,
    updatedAt: share.updatedAt,
    body: share.report,
  }
}

export function unpackDbReport(
  token: string,
  createdAt: string,
  cell: unknown,
): DbShare | null {
  if (!cell || typeof cell !== "object") return null
  const obj = cell as Record<string, unknown>

  if (obj.v === 2 && obj.body && typeof obj.body === "object") {
    const body = obj.body as SharedReport
    if (!body?.repo?.owner || !body?.repo?.name) return null
    return {
      token,
      createdAt,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : createdAt,
      repoKey: typeof obj.repoKey === "string" ? obj.repoKey : repoKeyOf(body.repo),
      manageKeyHash: typeof obj.manageKeyHash === "string" ? obj.manageKeyHash : "",
      report: body,
    }
  }

  // Legacy: bare SharedReport.
  const legacy = cell as SharedReport
  if (!legacy?.repo?.owner || !legacy?.repo?.name) return null
  return {
    token,
    createdAt,
    updatedAt: createdAt,
    repoKey: repoKeyOf(legacy.repo),
    manageKeyHash: "",
    report: legacy,
  }
}

export async function dbPutShare(
  cfg: SupabaseConfig,
  share: {
    token: string
    manageKeyHash: string
    repoKey: string
    updatedAt: string
    report: SharedReport
  },
): Promise<void> {
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
      body: JSON.stringify({ token: share.token, report: packDbReport(share) }),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Supabase insert failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

export async function dbUpdateShare(
  cfg: SupabaseConfig,
  share: {
    token: string
    manageKeyHash: string
    repoKey: string
    updatedAt: string
    report: SharedReport
  },
): Promise<void> {
  const params = new URLSearchParams({ token: `eq.${share.token}` })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
      method: "PATCH",
      headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
      body: JSON.stringify({ report: packDbReport(share) }),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Supabase update failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
}

export async function dbDeleteShare(cfg: SupabaseConfig, token: string): Promise<void> {
  const params = new URLSearchParams({ token: `eq.${token}` })
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, {
      method: "DELETE",
      headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Supabase delete failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
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

  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return null

  const rows = (await res.json()) as { token: string; created_at: string; report: unknown }[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null
  return unpackDbReport(row.token, row.created_at, row.report)
}

/**
 * Find the live manageable share for a repo.
 *
 * Filters on the v2 envelope field. Legacy rows without `repoKey` are invisible
 * here — they keep working by token, but a new publish for the same repo starts
 * a fresh stable link rather than trying to take over an unmanageable snapshot.
 */
export async function dbGetShareByRepoKey(
  cfg: SupabaseConfig,
  repoKey: string,
): Promise<DbShare | null> {
  const params = new URLSearchParams({
    "report->>repoKey": `eq.${repoKey}`,
    select: "token,created_at,report",
    limit: "1",
  })

  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) return null

  const rows = (await res.json()) as { token: string; created_at: string; report: unknown }[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null
  return unpackDbReport(row.token, row.created_at, row.report)
}
