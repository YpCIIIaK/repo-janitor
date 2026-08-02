import "server-only"
import { restHeaders, withTimeout, type SupabaseConfig } from "@/lib/share-db"
import type { StoredRepo } from "@/lib/server-store"

/**
 * Supabase backend for reports ingested from CI.
 *
 * Same shape as the other `*-db.ts` files — plain `fetch` against PostgREST, no
 * client library — and the same table policy: RLS on, no policies, so only the
 * service role reaches it and it is never readable from a browser.
 *
 * ## Why this exists
 *
 * `/api/ingest` used to write a JSON file under `.repo-anti-rot/`. On a
 * container host that disk is ephemeral: it is wiped on every deploy and on
 * every restart. The visible symptom was the README's health badge — it read
 * the latest ingested report, so it showed a grade after each push to main and
 * fell back to "unknown" the next time the service was redeployed. A badge that
 * blanks itself on a schedule nobody can predict is worse than no badge.
 *
 * ## One row per repository
 *
 * The primary key is `owner/name`, and the whole `StoredRepo` — latest report
 * plus trend history — lives in one jsonb column. That is deliberate: the
 * document is read and written as a unit, nothing queries inside it, and a
 * normalised schema would buy nothing but migrations. If history ever needs
 * querying, it becomes its own table then, on evidence.
 *
 * Run once in the Supabase SQL editor:
 *
 *   create table public.ingested_reports (
 *     id          text primary key,
 *     updated_at  timestamptz not null default now(),
 *     repo        jsonb not null
 *   );
 *   create index ingested_reports_updated_idx
 *     on public.ingested_reports (updated_at desc);
 *   alter table public.ingested_reports enable row level security;
 */

const TABLE = "ingested_reports"
const TIMEOUT_MS = 8_000

/** Bound on rows read at once. A dashboard that needs more than this needs paging, not a bigger number. */
export const REPO_ROW_LIMIT = 500



/** Every stored repository, newest first. */
export async function dbReadRepos(cfg: SupabaseConfig): Promise<StoredRepo[]> {
  const params = new URLSearchParams({
    select: "repo",
    order: "updated_at.desc",
    limit: String(REPO_ROW_LIMIT),
  })

  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) {
    throw new Error(`Report read failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const rows = (await res.json()) as { repo?: unknown }[]
  if (!Array.isArray(rows)) return []
  return rows
    .map((r) => r.repo)
    .filter((r): r is StoredRepo => !!r && typeof r === "object" && "id" in (r as object))
}

/** One repository by `owner/name`, or null when it has never been ingested. */
export async function dbReadRepo(cfg: SupabaseConfig, id: string): Promise<StoredRepo | null> {
  const params = new URLSearchParams({ select: "repo", id: `eq.${id}`, limit: "1" })

  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) {
    throw new Error(`Report read failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const rows = (await res.json()) as { repo?: StoredRepo }[]
  return Array.isArray(rows) && rows[0]?.repo ? rows[0].repo : null
}

/**
 * Insert or replace one repository's document.
 *
 * `Prefer: resolution=merge-duplicates` makes this an upsert on the primary key,
 * so two pushes landing at once cannot produce a duplicate row — the second
 * simply wins. That matters because the read-modify-write in `server-store` is
 * not atomic; the upsert is the part that keeps the table consistent even when
 * the sequence around it races.
 */
export async function dbWriteRepo(cfg: SupabaseConfig, repo: StoredRepo): Promise<void> {
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        ...restHeaders(cfg),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ id: repo.id, updated_at: new Date().toISOString(), repo }),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Report write failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
}
