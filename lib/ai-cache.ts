"use client"

/**
 * Persistent cache of AI verdicts, keyed by model + issue id.
 *
 * Issue ids are content-derived and stable across rescans, so once a finding has
 * been analyzed we never pay for it again — a rescan of the same repo re-uses the
 * cached note instead of hitting the model. Keyed by model too, since different
 * models give different verdicts. Bumping CACHE_VERSION invalidates everything
 * (e.g. after a prompt change).
 */

const KEY = "repo-anti-rot:ai-cache:v1"
const CACHE_VERSION = "2"
const MAX_ENTRIES = 2000

function entryKey(model: string, issueId: string): string {
  return `${CACHE_VERSION}::${model}::${issueId}`
}

function read(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function write(map: Record<string, string>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* quota / serialization error — cache is best-effort, ignore */
  }
}

/** Notes already cached for these issue ids under the given model. */
export function getCachedNotes(model: string, issueIds: string[]): Map<string, string> {
  const map = read()
  const out = new Map<string, string>()
  for (const id of issueIds) {
    const note = map[entryKey(model, id)]
    if (note) out.set(id, note)
  }
  return out
}

/** Store freshly-computed notes, trimming the oldest entries past the cap. */
export function putCachedNotes(model: string, entries: Array<[string, string]>): void {
  if (entries.length === 0) return
  const map = read()
  for (const [id, note] of entries) map[entryKey(model, id)] = note
  // Object string keys keep insertion order, so the first keys are the oldest.
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k]
  }
  write(map)
}

/** Wipe the whole AI verdict cache (e.g. a "re-run AI" affordance). */
export function clearAiCache(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(KEY)
}
