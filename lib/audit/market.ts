import "server-only"
import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * The bridge between the Python audit engine (packages/audit-engine) and this
 * dashboard. The engine owns the scraping and writes `data/market.json`; this
 * module only reads that snapshot and shapes it for the UI. Nothing here talks
 * to any bounty platform — keeping the network side in Python means the two
 * runtimes meet at a file, not an API, and either can be replaced without the
 * other noticing.
 */

/** One asset in a program's scope, as the engine records it. */
export interface MarketAsset {
  name: string
  type: string
  url: string
  desc: string
}

/** A raw record as it appears in packages/audit-engine/data/market.json. */
export interface MarketRecordRaw {
  site: string
  pid: string
  name: string
  url: string
  reward: number
  currency: string
  fee: number
  kyc: boolean
  reports: number
  assets?: MarketAsset[]
  repos?: string[]
  tags?: string[]
  updated?: string
}

/**
 * A program shaped for the UI, with the one metric the whole view is ranked by.
 *
 * `perSubmission` is the port of the Python engine's crowdedness idea: a
 * finding's reward is split among everyone who submitted it, so `reward /
 * reports` approximates the expected payout for one of *your* submissions.
 * A large fund on a crowded program is worth less per head than a modest fund
 * nobody has looked at — which is exactly what a plain reward column hides.
 */
export interface MarketProgram extends MarketRecordRaw {
  /** Expected dollars per submission; null when the program has no report count yet. */
  perSubmission: number | null
  /** Whether this program lists at least one public GitHub repo in scope. */
  hasRepos: boolean
}

let cache: { at: number; data: MarketProgram[] } | null = null
const TTL_MS = 60_000

function marketPath(): string {
  return path.join(process.cwd(), "packages", "audit-engine", "data", "market.json")
}

function shape(r: MarketRecordRaw): MarketProgram {
  const perSubmission =
    r.reports > 0 && r.reward > 0 ? Math.round(r.reward / r.reports) : null
  return {
    ...r,
    assets: r.assets ?? [],
    repos: r.repos ?? [],
    tags: r.tags ?? [],
    perSubmission,
    hasRepos: Array.isArray(r.repos) && r.repos.length > 0,
  }
}

/** Read and shape the market snapshot, cached briefly so a burst of requests hits disk once. */
export async function readMarket(): Promise<MarketProgram[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  const raw = await readFile(marketPath(), "utf8")
  const parsed = JSON.parse(raw) as MarketRecordRaw[]
  const data = parsed.map(shape)
  cache = { at: Date.now(), data }
  return data
}

export type MarketSort = "density" | "reward" | "reports"

export interface MarketQuery {
  site?: string
  sort?: MarketSort
  reposOnly?: boolean
  noKyc?: boolean
  search?: string
  limit?: number
}

/** Filter and rank the snapshot. Default sort is by crowdedness (best pay-per-submission first). */
export function rankMarket(all: MarketProgram[], q: MarketQuery = {}): MarketProgram[] {
  let rows = all
  if (q.site) rows = rows.filter((r) => r.site === q.site)
  if (q.reposOnly) rows = rows.filter((r) => r.hasRepos)
  if (q.noKyc) rows = rows.filter((r) => !r.kyc)
  if (q.search) {
    const needle = q.search.toLowerCase()
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle))
  }
  const sort = q.sort ?? "density"
  const sorted = [...rows].sort((a, b) => {
    if (sort === "reward") return b.reward - a.reward
    if (sort === "reports") return b.reports - a.reports
    // density: highest expected pay-per-submission first; unknowns sink.
    const av = a.perSubmission ?? -1
    const bv = b.perSubmission ?? -1
    return bv - av
  })
  return q.limit ? sorted.slice(0, q.limit) : sorted
}

/** Distinct platform names present in the snapshot, for the site filter. */
export function marketSites(all: MarketProgram[]): string[] {
  return [...new Set(all.map((r) => r.site))].sort()
}
