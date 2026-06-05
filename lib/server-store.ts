import "server-only"
import { promises as fs } from "fs"
import { join } from "path"
import type { Grade, Issue, Severity } from "@/lib/mock-data"

/**
 * Server-side report store (filesystem).
 *
 * `/api/ingest` writes here so reports POSTed from CI survive across browsers and
 * devices; `/api/reports` reads it back for the dashboard to merge into its store.
 * Shape mirrors the client's `StoredRepo` (lib/reports-store) so the UI consumes it
 * unchanged. Single JSON file under `.repo-anti-rot/` — simple and inspectable; swap for
 * SQLite/Postgres when history/query volume grows (ROADMAP D2).
 */

export interface ScanReport {
  schemaVersion: number
  repo: { owner: string; name: string; defaultBranch: string }
  generatedAt: string
  score: number
  grade: Grade
  issues: Issue[]
}

export interface TrendPoint {
  at: string
  score: number
  critical: number
  warning: number
  info: number
}

export interface StoredRepo {
  id: string // `${owner}/${name}`
  owner: string
  name: string
  defaultBranch: string
  latest: ScanReport
  history: TrendPoint[]
  scannedAt: string
}

const DIR = join(process.cwd(), ".repo-anti-rot")
const FILE = join(DIR, "reports.json")
const MAX_HISTORY = 50

function countSeverity(issues: Issue[], sev: Severity): number {
  return issues.filter((i) => i.severity === sev).length
}

export async function readServerRepos(): Promise<StoredRepo[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredRepo[]) : []
  } catch {
    // missing file / unreadable → empty store
    return []
  }
}

async function writeServerRepos(list: StoredRepo[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(FILE, JSON.stringify(list, null, 2), "utf-8")
}

/** Outcome of an upsert: the stored repo plus the report it replaced (if any),
 * so callers can diff old → new (e.g. to fire a score-drop alert). */
export interface UpsertResult {
  repo: StoredRepo
  /** the previously-stored latest report for this repo, or null on first ingest */
  previous: ScanReport | null
}

/** Upsert a report: refresh the repo's latest and append a trend point. */
export async function upsertServerReport(report: ScanReport): Promise<UpsertResult> {
  const { owner, name, defaultBranch } = report.repo
  const id = `${owner}/${name}`
  const at = report.generatedAt || new Date().toISOString()
  const point: TrendPoint = {
    at,
    score: report.score,
    critical: countSeverity(report.issues, "critical"),
    warning: countSeverity(report.issues, "warning"),
    info: countSeverity(report.issues, "info"),
  }

  const list = await readServerRepos()
  const existing = list.find((r) => r.id === id)
  if (existing) {
    const previous = existing.latest // capture before overwrite
    existing.latest = report
    existing.defaultBranch = defaultBranch
    existing.scannedAt = at
    existing.history = [...existing.history.filter((p) => p.at !== at), point].slice(-MAX_HISTORY)
    await writeServerRepos(list)
    return { repo: existing, previous }
  }

  const created: StoredRepo = {
    id,
    owner,
    name,
    defaultBranch,
    latest: report,
    history: [point],
    scannedAt: at,
  }
  list.unshift(created)
  await writeServerRepos(list)
  return { repo: created, previous: null }
}
