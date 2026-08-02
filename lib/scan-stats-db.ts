import "server-only"
import { restHeaders, withTimeout, type SupabaseConfig } from "@/lib/share-db"
import type { ScanStat, SizeBucket } from "@/lib/scan-stats"

/**
 * Supabase backend for the score distribution.
 *
 * Same shape as `lib/usage-db.ts` — plain `fetch` against PostgREST, no client
 * library — and the same table policy: RLS on, no policies, so only the service
 * role reaches it and it is never readable from a browser.
 *
 * Deliberately a **separate table** from `usage_events`. That one holds the
 * repository and no score; this one holds the score and no repository. Keeping
 * them in one table with a nullable column would make the separation a matter of
 * discipline, and discipline is what erodes.
 *
 * Run once in the Supabase SQL editor:
 *
 *   create table public.scan_stats (
 *     id        bigint generated always as identity primary key,
 *     day       date not null,
 *     score     smallint not null,
 *     grade     text not null,
 *     language  text,
 *     size      text not null,
 *     critical  integer not null default 0,
 *     warning   integer not null default 0,
 *     info      integer not null default 0,
 *     ci        boolean not null default false,
 *     tests     boolean not null default false
 *   );
 *   create index scan_stats_day_idx on public.scan_stats (day desc);
 *   create index scan_stats_cut_idx on public.scan_stats (language, size);
 *   alter table public.scan_stats enable row level security;
 *
 * Note what the table has no column for: owner, name, host, url, visitor,
 * commit. Not "we do not write them" — there is nowhere to put them, which is a
 * stronger statement and survives someone editing this file in a hurry.
 *
 * `day` is a date rather than a timestamptz on purpose: it is the coarsest thing
 * that still allows "the last 90 days", and it stops a row here being lined up
 * against a `usage_events` row by the second.
 */

const TABLE = "scan_stats"
const TIMEOUT_MS = 5_000

/** Rows pulled for one distribution query. Aggregation happens in JS. */
export const DISTRIBUTION_ROW_LIMIT = 20_000



export async function dbRecordScanStat(cfg: SupabaseConfig, row: ScanStat): Promise<void> {
  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...restHeaders(cfg), Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Scan-stat insert failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
}

export interface DistributionFilter {
  language?: string | null
  size?: SizeBucket
}

/**
 * Scores only, for one cut of the distribution.
 *
 * `select=score` rather than `select=*`: the query that builds a percentile has
 * no use for the rest of the row, and a query that cannot return a field cannot
 * leak it into a log.
 */
export async function dbScores(
  cfg: SupabaseConfig,
  filter: DistributionFilter = {},
): Promise<number[]> {
  const params = new URLSearchParams({
    select: "score",
    limit: String(DISTRIBUTION_ROW_LIMIT),
  })
  if (filter.language) params.set("language", `eq.${filter.language}`)
  if (filter.size) params.set("size", `eq.${filter.size}`)

  const res = await withTimeout(TIMEOUT_MS, (signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: restHeaders(cfg), signal }),
  )
  if (!res.ok) {
    throw new Error(`Scan-stat read failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const rows = (await res.json()) as { score?: unknown }[]
  return Array.isArray(rows)
    ? rows.map((r) => r.score).filter((s): s is number => typeof s === "number")
    : []
}
