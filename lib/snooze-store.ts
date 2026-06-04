"use client"

import { useSyncExternalStore } from "react"
import type { Issue } from "@/lib/mock-data"

/**
 * Client-side "snooze / ignore" store for individual findings.
 *
 * A snoozed issue is treated as won't-fix: hidden from the table by default and
 * excluded from severity counts and the recomputed health score. State lives in
 * localStorage keyed by `${repoId}::${issueId}`. Issue ids are content-derived
 * and stable across rescans, so a snooze survives re-scanning the same repo.
 */

const KEY = "repo-anti-rot:snoozed:v1"
const EVENT = "repo-anti-rot:snoozed:changed"

const EMPTY: string[] = []

export function snoozeKey(repoId: string, issueId: string): string {
  return `${repoId}::${issueId}`
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readFresh(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeAll(keys: string[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(keys))
  window.dispatchEvent(new Event(EVENT))
}

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing (stable Set snapshot)
// ---------------------------------------------------------------------------

let cachedString: string | null = null
let cachedSet: Set<string> = new Set()

function getSnapshot(): Set<string> {
  if (typeof window === "undefined") return cachedSet
  const raw = window.localStorage.getItem(KEY)
  if (raw === cachedString) return cachedSet
  cachedString = raw
  try {
    cachedSet = new Set(raw ? (JSON.parse(raw) as string[]) : EMPTY)
  } catch {
    cachedSet = new Set()
  }
  return cachedSet
}

function getServerSnapshot(): Set<string> {
  return cachedSet
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

/** React hook: live Set of snoozed keys (`${repoId}::${issueId}`). */
export function useSnoozed(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setSnoozed(repoId: string, issueId: string, snoozed: boolean): void {
  const key = snoozeKey(repoId, issueId)
  const list = readFresh()
  const has = list.includes(key)
  if (snoozed && !has) writeAll([...list, key])
  else if (!snoozed && has) writeAll(list.filter((k) => k !== key))
}

/** Drop every snooze for a repo (used when a repo is removed). */
export function clearSnoozedForRepo(repoId: string): void {
  const prefix = `${repoId}::`
  const list = readFresh()
  const next = list.filter((k) => !k.startsWith(prefix))
  if (next.length !== list.length) writeAll(next)
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Split a repo's issues into the live (not snoozed) and snoozed buckets. */
export function partitionSnoozed(
  repoId: string,
  issues: Issue[],
  snoozed: Set<string>,
): { live: Issue[]; muted: Issue[] } {
  const live: Issue[] = []
  const muted: Issue[] = []
  for (const issue of issues) {
    if (snoozed.has(snoozeKey(repoId, issue.id))) muted.push(issue)
    else live.push(issue)
  }
  return { live, muted }
}
