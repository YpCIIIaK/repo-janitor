"use client"

import { useSyncExternalStore } from "react"
import type { Grade, Issue, Severity, StatCard } from "@/lib/mock-data"

/**
 * Client-side persistence for real scan reports.
 *
 * Reports are stored in localStorage so scanned repos survive a reload and
 * populate the sidebar + dashboard. Each repo keeps its latest full report plus
 * a small history of score/severity points, which powers a real trend chart.
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
  at: string // ISO timestamp of the scan
  score: number
  critical: number
  warning: number
  info: number
}

export interface StoredRepo {
  id: string // `${owner}/${name}`
  url?: string
  owner: string
  name: string
  defaultBranch: string
  latest: ScanReport
  history: TrendPoint[]
  scannedAt: string // ISO of latest scan
}

const KEY = "repo-anti-rot:reports:v1"
const EVENT = "repo-anti-rot:reports:changed"
const MAX_HISTORY = 50

const EMPTY: StoredRepo[] = []

// ---------------------------------------------------------------------------
// Low-level storage
// ---------------------------------------------------------------------------

function readFresh(): StoredRepo[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoredRepo[]) : []
  } catch {
    return []
  }
}

function writeAll(list: StoredRepo[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(list))
  // notify same-tab subscribers (the native `storage` event only fires cross-tab)
  window.dispatchEvent(new Event(EVENT))
}

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing (referentially stable snapshots)
// ---------------------------------------------------------------------------

let cachedString: string | null = null
let cachedValue: StoredRepo[] = EMPTY

function getSnapshot(): StoredRepo[] {
  if (typeof window === "undefined") return EMPTY
  const raw = window.localStorage.getItem(KEY)
  if (raw === cachedString) return cachedValue
  cachedString = raw
  try {
    cachedValue = raw ? (JSON.parse(raw) as StoredRepo[]) : EMPTY
  } catch {
    cachedValue = EMPTY
  }
  return cachedValue
}

function getServerSnapshot(): StoredRepo[] {
  return EMPTY
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(EVENT, callback)
  }
}

/** React hook: the live list of scanned repos, sorted most-recent first. */
export function useRepos(): StoredRepo[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function countSeverity(issues: Issue[], sev: Severity): number {
  return issues.filter((i) => i.severity === sev).length
}

/** Upsert a scan report: updates the repo's latest report and appends a trend point. */
export function saveReport(report: ScanReport, url?: string): void {
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

  const list = readFresh()
  const existing = list.find((r) => r.id === id)
  if (existing) {
    existing.latest = report
    existing.defaultBranch = defaultBranch
    existing.scannedAt = at
    if (url) existing.url = url
    // de-dupe a point with the identical timestamp, then cap history length
    existing.history = [...existing.history.filter((p) => p.at !== at), point].slice(-MAX_HISTORY)
    writeAll(list)
  } else {
    list.unshift({ id, url, owner, name, defaultBranch, latest: report, history: [point], scannedAt: at })
    writeAll(list)
  }
}

/**
 * Merge server-stored repos (from `/api/reports`) into the local store. Used on
 * load so CI-ingested reports appear in the UI. Histories are unioned by timestamp
 * and the newer scan wins as `latest`, so local scans and server ingests coexist.
 * Returns true when anything changed (avoids a redundant write/notify).
 */
export function mergeServerRepos(serverRepos: StoredRepo[]): boolean {
  if (!serverRepos || serverRepos.length === 0) return false
  const list = readFresh()
  let changed = false

  for (const incoming of serverRepos) {
    const existing = list.find((r) => r.id === incoming.id)
    if (!existing) {
      list.unshift(incoming)
      changed = true
      continue
    }

    // union history by timestamp, sorted ascending, capped
    const seen = new Set(existing.history.map((p) => p.at))
    const merged = [...existing.history]
    for (const p of incoming.history) {
      if (!seen.has(p.at)) {
        merged.push(p)
        changed = true
      }
    }
    merged.sort((a, b) => a.at.localeCompare(b.at))
    existing.history = merged.slice(-MAX_HISTORY)

    // newer scan wins as latest
    if (incoming.scannedAt > existing.scannedAt) {
      existing.latest = incoming.latest
      existing.scannedAt = incoming.scannedAt
      existing.defaultBranch = incoming.defaultBranch
      changed = true
    }
  }

  if (changed) writeAll(list)
  return changed
}

export function removeRepo(id: string): void {
  writeAll(readFresh().filter((r) => r.id !== id))
}

export function clearAll(): void {
  writeAll([])
}

// ---------------------------------------------------------------------------
// Selectors (pure — derive dashboard data from a stored repo)
// ---------------------------------------------------------------------------

export function repoStats(repo: StoredRepo): StatCard[] {
  const issues = repo.latest.issues
  const h = repo.history
  const last = h[h.length - 1]
  const prev = h.length > 1 ? h[h.length - 2] : undefined
  const critical = countSeverity(issues, "critical")
  const branches = issues.filter((i) => i.category === "branch").length
  const open = issues.length
  const scoreDelta = prev ? last.score - prev.score : 0
  const critDelta = prev ? last.critical - prev.critical : 0
  const openDelta = prev ? last.critical + last.warning + last.info - (prev.critical + prev.warning + prev.info) : 0

  return [
    {
      label: "Health Score",
      value: String(repo.latest.score),
      delta: scoreDelta,
      deltaLabel: prev ? "vs last scan" : "first scan",
      tone: scoreDelta > 0 ? "good" : scoreDelta < 0 ? "bad" : "neutral",
    },
    {
      label: "Critical Issues",
      value: String(critical),
      delta: critDelta,
      deltaLabel: critical > 0 ? "needs attention" : "all clear",
      tone: critical > 0 ? "bad" : "good",
    },
    {
      label: "Open Issues",
      value: String(open),
      delta: openDelta,
      deltaLabel: "tracked",
      tone: open === 0 ? "good" : "neutral",
    },
    {
      label: "Stale Branches",
      value: String(branches),
      delta: 0,
      deltaLabel: branches === 0 ? "all clean" : "needs pruning",
      tone: branches > 0 ? "neutral" : "good",
    },
  ]
}

export interface ChartPoint {
  date: string
  score: number
  critical: number
  warning: number
  info: number
}

function trendLabel(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function repoTrend(repo: StoredRepo): ChartPoint[] {
  return repo.history.map((p) => ({
    date: trendLabel(p.at),
    score: p.score,
    critical: p.critical,
    warning: p.warning,
    info: p.info,
  }))
}

/** Relative time like "3 hours ago" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return "just now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`
  return `${Math.floor(months / 12)}y ago`
}
