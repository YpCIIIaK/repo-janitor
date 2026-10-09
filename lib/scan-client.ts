"use client"

import type { ScanReport } from "@/lib/reports-store"
import { usageHeaders } from "@/lib/visitor"

/**
 * Client for the streaming `/api/scan` endpoint.
 *
 * The server streams NDJSON events as it clones and scans each repo. We parse
 * them line-by-line, drive progress callbacks in real time, and resolve with the
 * final per-repo results — so callers don't need to know about the wire format.
 */

export interface ScanResult {
  url: string
  ok: boolean
  report?: ScanReport
  error?: string
}

type ServerEvent =
  | { type: "queued"; url: string; position: number }
  | { type: "start"; total: number }
  | { type: "repo-start"; url: string; index: number; total: number }
  | { type: "phase"; url: string; phase: "clone" | "scan" | "activity" }
  | { type: "scanner"; url: string; scanner?: string; completed: number; total: number }
  | { type: "repo-done"; url: string; ok: boolean; report?: ScanReport; error?: string }
  | { type: "done" }

export interface ScanProgressState {
  /** overall fraction in [0,1] across all repos */
  fraction: number
  /** human-readable status line */
  label: string
  /** repos finished so far */
  reposDone: number
  /** total repos */
  reposTotal: number
}

export interface RunScanHandlers {
  /** Persist each completed result before the stream or later AI work can fail. */
  onResult?: (result: ScanResult) => void
  onProgress?: (state: ScanProgressState) => void
  signal?: AbortSignal
  /** Subset of scanner ids; omit / null for the full registry. */
  only?: string[] | null
}

const PHASE_LABEL = { clone: "Cloning", scan: "Scanning", activity: "Loading commit history" } as const

/** POST urls to /api/scan and stream progress; resolves with final results. */
export async function runScanStream(
  urls: string[],
  handlers: RunScanHandlers = {},
): Promise<ScanResult[]> {
  const body: { urls: string[]; only?: string[] } = { urls }
  if (handlers.only && handlers.only.length > 0) body.only = handlers.only

  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...usageHeaders() },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  // Non-stream error (validation, etc.) comes back as plain JSON.
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }

  const total = urls.length
  const results: ScanResult[] = []
  const pending = new Set(urls)
  let reposDone = 0
  let currentFrac = 0 // progress within the current repo, [0,1]
  let label = "Starting…"

  const emit = () => {
    handlers.onProgress?.({
      fraction: total === 0 ? 1 : Math.min(1, (reposDone + currentFrac) / total),
      label,
      reposDone,
      reposTotal: total,
    })
  }

  const handle = (ev: ServerEvent) => {
    switch (ev.type) {
      case "queued":
        label = `Waiting for a scan slot · queue ${ev.position}`
        emit()
        break
      case "repo-start":
        currentFrac = 0
        label = total > 1 ? `Repo ${ev.index + 1}/${total}…` : "Preparing…"
        emit()
        break
      case "phase":
        // clone counts as the first slice of a repo; scan starts the scanner ramp
        currentFrac = ev.phase === "clone" ? 0.05 : ev.phase === "activity" ? 0.95 : 0.15
        label = `${PHASE_LABEL[ev.phase]}${total > 1 ? ` (${reposDone + 1}/${total})` : ""}…`
        emit()
        break
      case "scanner":
        // Reserve the final slice for history loading and the completed report.
        if (ev.total > 0) currentFrac = 0.15 + 0.8 * Math.min(1, ev.completed / ev.total)
        label = ev.scanner ? `Scanning · ${ev.scanner}` : "Scanning…"
        emit()
        break
      case "repo-done": {
        if (!pending.has(ev.url) || typeof ev.ok !== "boolean") break
        if (ev.ok && (!ev.report?.repo || !Array.isArray(ev.report.issues))) break
        pending.delete(ev.url)
        const result = { url: ev.url, ok: ev.ok, report: ev.report, error: ev.error }
        results.push(result)
        handlers.onResult?.(result)
        reposDone++
        currentFrac = 0
        emit()
        break
      }
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const parseLine = (line: string) => {
    if (!line.trim()) return
    let ev: ServerEvent
    try { ev = JSON.parse(line) as ServerEvent } catch { return }
    if (ev && typeof ev === "object") handle(ev)
  }
  let failure = "Scan connection ended before a result arrived. Please retry."
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        parseLine(line)
      }
    }
    buf += decoder.decode()
    parseLine(buf)
  } catch {
    failure = handlers.signal?.aborted
      ? "Scan cancelled. Completed reports were retained."
      : "Scan connection interrupted. Completed reports were retained; retry the unfinished repository."
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  for (const url of pending) results.push({ url, ok: false, error: failure })

  return results
}
