"use client"

import { useSyncExternalStore } from "react"
import type { StoredRepo } from "@/lib/reports-store"

/**
 * Client-side scan schedule.
 *
 * While the dashboard is open, a background ticker (see `ScanScheduler`) re-scans
 * tracked repos on this schedule. Because the repo list and reports live in the
 * browser (localStorage), scheduling is client-side too — it runs only while a
 * tab is open. For unattended scanning (machine asleep / tab closed), use the
 * GitHub Action's `schedule:` trigger instead.
 *
 * Two flexible modes:
 *  - **interval** — re-scan each repo every N hours since *its* last scan
 *    (N is any value ≥ 0.25h).
 *  - **daily** — re-scan once per day at a chosen local time (any HH:MM), with
 *    catch-up if the tab was closed at that moment.
 */

export type ScheduleMode = "interval" | "daily"

export interface ScheduleSettings {
  enabled: boolean
  mode: ScheduleMode
  /** interval mode: hours between scans of a given repo (since its last scan) */
  intervalHours: number
  /** daily mode: local time of day, "HH:MM" (24h) */
  dailyTime: string
}

export const MIN_INTERVAL_HOURS = 0.25 // 15 minutes — guardrail against hammering

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  enabled: false,
  mode: "interval",
  intervalHours: 24,
  dailyTime: "03:00",
}

const KEY = "repo-anti-rot:schedule:v1"
const EVENT = "repo-anti-rot:schedule:changed"

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function normalize(raw: unknown): ScheduleSettings {
  const o = (raw ?? {}) as Partial<ScheduleSettings>
  const intervalHours =
    typeof o.intervalHours === "number" && o.intervalHours >= MIN_INTERVAL_HOURS
      ? o.intervalHours
      : DEFAULT_SCHEDULE.intervalHours
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_SCHEDULE.enabled,
    mode: o.mode === "daily" ? "daily" : "interval",
    intervalHours,
    dailyTime: typeof o.dailyTime === "string" && HHMM_RE.test(o.dailyTime) ? o.dailyTime : DEFAULT_SCHEDULE.dailyTime,
  }
}

/** Local timestamp (ms) for today's `HH:MM`. */
function todayTargetMs(dailyTime: string, now: number): number {
  const [h, m] = dailyTime.split(":").map((n) => parseInt(n, 10))
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/**
 * Is this repo due for a scheduled re-scan right now? Repos without a source URL
 * (ingested from CI) can't be cloned locally, so they're never due.
 */
export function isRepoDue(settings: ScheduleSettings, repo: StoredRepo, now: number = Date.now()): boolean {
  if (!settings.enabled || !repo.url) return false
  const last = Date.parse(repo.scannedAt) || 0
  if (settings.mode === "interval") {
    return now - last >= settings.intervalHours * 3_600_000
  }
  // daily: due once today's target time has passed and we haven't scanned since.
  const target = todayTargetMs(settings.dailyTime, now)
  return now >= target && last < target
}

/** Repos that should be (re)scanned now, oldest-scan first. */
export function dueRepos(settings: ScheduleSettings, repos: StoredRepo[], now: number = Date.now()): StoredRepo[] {
  return repos
    .filter((r) => isRepoDue(settings, r, now))
    .sort((a, b) => (Date.parse(a.scannedAt) || 0) - (Date.parse(b.scannedAt) || 0))
}

/** A short human description of the active schedule, for the settings UI. */
export function describeSchedule(settings: ScheduleSettings): string {
  if (!settings.enabled) return "Off"
  if (settings.mode === "interval") {
    const h = settings.intervalHours
    const label = h < 1 ? `${Math.round(h * 60)} min` : h === 1 ? "hour" : `${h % 1 === 0 ? h : h.toFixed(1)} hours`
    return `Every ${label}, per repo`
  }
  return `Daily at ${settings.dailyTime}`
}

// ---------------------------------------------------------------------------
// Storage + React plumbing (mirrors ai-settings)
// ---------------------------------------------------------------------------

export function readSchedule(): ScheduleSettings {
  if (typeof window === "undefined") return DEFAULT_SCHEDULE
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_SCHEDULE
  } catch {
    return DEFAULT_SCHEDULE
  }
}

export function saveSchedule(next: ScheduleSettings): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(normalize(next)))
  window.dispatchEvent(new Event(EVENT))
}

let cachedString: string | null = null
let cachedValue: ScheduleSettings = DEFAULT_SCHEDULE

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function getSnapshot(): ScheduleSettings {
  if (typeof window === "undefined") return DEFAULT_SCHEDULE
  const raw = window.localStorage.getItem(KEY)
  if (raw === cachedString) return cachedValue
  cachedString = raw
  cachedValue = raw ? normalize(safeParse(raw)) : DEFAULT_SCHEDULE
  return cachedValue
}

function getServerSnapshot(): ScheduleSettings {
  return DEFAULT_SCHEDULE
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

/** React hook: the live schedule settings. */
export function useSchedule(): ScheduleSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
