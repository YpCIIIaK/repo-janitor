"use client"

import { useSyncExternalStore } from "react"

/**
 * The browser half of usage statistics: a random visitor id, and the switch that
 * turns it off.
 *
 * The id is minted here, in the browser, and is the only thing that links two
 * scans to one person. It is not derived from anything — not the IP, not the user
 * agent, not a fingerprint — so it says nothing about who you are and nothing at
 * all outside our own table. Clearing site data makes you a new visitor, which is
 * the honest behaviour: we are counting returns, not tracking people.
 *
 * See `lib/usage.ts` for what the server does with it, and for the list of things
 * that are never recorded.
 */

const ID_KEY = "repo-anti-rot:visitor:v1"
const OPT_OUT_KEY = "repo-anti-rot:usage-opt-out:v1"
const EVENT = "repo-anti-rot:usage-opt-out:changed"

/** Mirrors `VISITOR_OPT_OUT` in lib/usage.ts — the server skips the row entirely. */
const OPT_OUT_VALUE = "opt-out"

/** Header name, mirroring `VISITOR_HEADER` in lib/usage.ts. */
export const VISITOR_HEADER = "x-repo-anti-rot-visitor"

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Older Safari / non-secure contexts. Shape matters (the server validates it),
  // randomness quality does not — this is a bucket label, not a secret.
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b) =>
    b.toString(16).padStart(2, "0"),
  )
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-")
}

export function usageOptedOut(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === "1"
  } catch {
    return false
  }
}

export function setUsageOptedOut(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (value) window.localStorage.setItem(OPT_OUT_KEY, "1")
    else window.localStorage.removeItem(OPT_OUT_KEY)
    // Opting out also destroys the id. Keeping it around "in case they change
    // their mind" would mean the identifier outlives the consent to use it.
    if (value) window.localStorage.removeItem(ID_KEY)
  } catch {
    /* private mode — nothing to persist, which is itself opting out */
  }
  window.dispatchEvent(new Event(EVENT))
}

/**
 * The header value to send with a request, or null when statistics are off in a
 * way the caller cannot distinguish from a network error (private mode).
 */
export function visitorId(): string {
  if (typeof window === "undefined") return OPT_OUT_VALUE
  if (usageOptedOut()) return OPT_OUT_VALUE
  try {
    const existing = window.localStorage.getItem(ID_KEY)
    if (existing) return existing
    const fresh = randomId()
    window.localStorage.setItem(ID_KEY, fresh)
    return fresh
  } catch {
    // No storage means no stable id. Sending a fresh one per request would
    // inflate "unique visitors" with phantoms, so send nothing and be counted
    // in the anonymous bucket instead.
    return ""
  }
}

/** Headers to merge into a fetch that should be counted. */
export function usageHeaders(): Record<string, string> {
  const id = visitorId()
  return id ? { [VISITOR_HEADER]: id } : {}
}

// ---------------------------------------------------------------------------

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(EVENT, callback)
  }
}

function getServerSnapshot(): boolean {
  return false
}

/** React hook: true when the user has switched usage statistics off. */
export function useUsageOptedOut(): boolean {
  return useSyncExternalStore(subscribe, usageOptedOut, getServerSnapshot)
}
