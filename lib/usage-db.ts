import "server-only"
import type { SupabaseConfig } from "@/lib/share-db"
import type { UsageEventName } from "@/lib/usage"

/**
 * Supabase backend for usage statistics.
 *
 * Same shape as `lib/share-db.ts` — plain `fetch` against PostgREST, no client
 * library — and the same table policy: RLS on, no policies, so only the service
 * role reaches it and it is never readable from a browser.
 *
 * Run once in the Supabase SQL editor:
 *
 *   create table public.usage_events (
 *     id       bigint generated always as identity primary key,
 *     at       timestamptz not null default now(),
 *     visitor  text not null,
 *     event    text not null,
 *     host     text,
 *     repo     text,
 *     amount   integer not null default 1,
 *     ok       boolean
 *   );
 *   create index usage_events_at_idx on public.usage_events (at desc);
 *   alter table public.usage_events enable row level security;
 *
 * Worth adding once there is real traffic — nobody needs last year's rows to
 * answer "how is it going", and data you do not keep cannot leak:
 *
 *   delete from public.usage_events where at < now() - interval '180 days';
 */

const TABLE = "usage_events"
const TIMEOUT_MS = 5_000

/** Rows pulled for one stats query. Aggregation happens in JS — see `dbUsageRows`. */
export const STATS_ROW_LIMIT = 20_000

export interface UsageRow {
  at: string
  visitor: string
  event: UsageEventName
  host: string | null
  repo: string | null
  amount: number
  ok: boolean | null
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

export async function dbRecordUsage(
  cfg: SupabaseConfig,
  row: Omit<UsageRow, "at">,
): Promise<void> {
  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...headers(cfg), Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal,
    }),
  )
  if (!res.ok) {
    throw new Error(`Usage insert failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
}

/**
 * Raw rows since a cut-off, newest first.
 *
 * Deliberately not a SQL `group by`: PostgREST cannot express one without a
 * database view or RPC, and adding either means schema a self-hoster has to keep
 * in sync with this file. At the volume a tool like this sees, pulling rows and
 * counting them in JS costs milliseconds. `STATS_ROW_LIMIT` is the point where
 * that stops being true — if it is ever hit, the answer is a view, not a bigger
 * limit, and the endpoint says so in its response.
 */
export async function dbUsageRows(cfg: SupabaseConfig, sinceIso: string): Promise<UsageRow[]> {
  const params = new URLSearchParams({
    at: `gte.${sinceIso}`,
    select: "at,visitor,event,host,repo,amount,ok",
    order: "at.desc",
    limit: String(STATS_ROW_LIMIT),
  })

  const res = await withTimeout((signal) =>
    fetch(`${cfg.url}/rest/v1/${TABLE}?${params}`, { headers: headers(cfg), signal }),
  )
  if (!res.ok) {
    throw new Error(`Usage read failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  const rows = (await res.json()) as UsageRow[]
  return Array.isArray(rows) ? rows : []
}
