"use client"

import { usageHeaders } from "@/lib/visitor"
import { useMemo, useSyncExternalStore } from "react"
import type { RunScanHandlers, ScanResult, ScanProgressState } from "@/lib/scan-client"

const KEY = "repo-janitor.pending-scan.v1"
const EVENT = "repo-janitor.pending-scan.changed"
export interface PendingScan { id: string; urls: string[]; only?: string[] | null }
interface Snapshot { status: string; progress: ScanProgressState; results: ScanResult[]; error?: string; expiresAt: number; archiveInfo?: { compressedBytes: number; originalBytes: number } }
export interface ArchiveNotice { expiresAt: number; compressedBytes: number; originalBytes: number }

export function pendingScan(): PendingScan | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null")
    return value && /^[a-f0-9]{64}$/.test(value.id) && Array.isArray(value.urls) ? value : null
  } catch { return null }
}

export function forgetPendingScan() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback) }
}
function snapshot() { try { return localStorage.getItem(KEY) } catch { return null } }
export function usePendingScan() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null)
  return useMemo(() => {
    try {
      const value = JSON.parse(raw ?? "null")
      return value && /^[a-f0-9]{64}$/.test(value.id) && Array.isArray(value.urls) ? value as PendingScan : null
    } catch { return null }
  }, [raw])
}

async function submit(job: PendingScan, signal?: AbortSignal) {
  const response = await fetch("/api/scan", {
    method: "POST", headers: { "Content-Type": "application/json", ...usageHeaders(), "X-Scan-Job": job.id },
    body: JSON.stringify({ urls: job.urls, only: job.only }), signal,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error ?? `Could not submit scan (${response.status})`)
  }
}

/** Aborting stops observation, not server execution. The saved capability lets
 * the same browser reconnect; it is never included in a URL or share link. */
export async function runBackgroundScan(urls: string[], handlers: RunScanHandlers & { onArchive?: (notice: ArchiveNotice) => void } = {}, resume?: PendingScan): Promise<ScanResult[]> {
  let job = resume
  if (!job) {
    if (pendingScan()) throw new Error("A recoverable scan already exists. Reconnect to it or dismiss it before starting another.")
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    job = { id: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""), urls, only: handlers.only }
    // Fail before starting work if this browser cannot retain a recovery key.
    localStorage.setItem(KEY, JSON.stringify(job))
    window.dispatchEvent(new Event(EVENT))
    await submit(job, handlers.signal)
  }
  const delivered = new Set<string>()
  let failures = 0
  for (;;) {
    handlers.signal?.throwIfAborted()
    let snapshot: Snapshot
    try {
      const response = await fetch("/api/scan/job", {
        headers: { Authorization: `Bearer ${job.id}` }, cache: "no-store",
        signal: handlers.signal ? AbortSignal.any([handlers.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      })
      if (response.status === 404) throw new MissingJobError()
      if (!response.ok) throw new Error(`Status unavailable (${response.status})`)
      snapshot = await response.json() as Snapshot
      if (!snapshot.progress || !Array.isArray(snapshot.results)) throw new Error("Invalid scan response")
    } catch (err) {
      if (err instanceof MissingJobError) throw new Error("Scan not found: submission may have failed, or the job expired or was lost after a restart. Dismiss it and start a new scan.")
      if (handlers.signal?.aborted) throw err
      if (++failures >= 5) throw new Error("Cannot reconnect right now. Your scan may still be running. Use Reconnect to retrieve it later.")
      handlers.onProgress?.({ fraction: 0, label: "Connection lost — reconnecting…", reposDone: delivered.size, reposTotal: job.urls.length })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      continue
    }
    failures = 0
    handlers.onProgress?.(snapshot.progress)
    if (snapshot.archiveInfo && snapshot.results.some((r) => r.ok)) handlers.onArchive?.({ ...snapshot.archiveInfo, expiresAt: snapshot.expiresAt })
    for (const result of snapshot.results) {
      if (!delivered.has(result.url)) {
        handlers.onResult?.(result)
        delivered.add(result.url)
      }
    }
    if (snapshot.status === "completed" || snapshot.status === "failed") {
      const results = [...snapshot.results]
      for (const url of job.urls) {
        if (!results.some((r) => r.url === url)) results.push({ url, ok: false, error: snapshot.error ?? "Scan ended without a result. Please retry." })
      }
      // Keep the recovery capability until explicit dismissal: localStorage
      // report persistence can fail (quota), even though the server archive exists.
      return results
    }
    await new Promise((resolve) => setTimeout(resolve, 15000))
  }
}

class MissingJobError extends Error {}
