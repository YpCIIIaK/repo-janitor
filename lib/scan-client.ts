"use client"

import type { ScanReport } from "@/lib/reports-store"

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
  | { type: "start"; total: number }
  | { type: "repo-start"; url: string; index: number; total: number }
  | { type: "phase"; url: string; phase: "clone" | "scan" }
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
  onProgress?: (state: ScanProgressState) => void
  signal?: AbortSignal
}

const PHASE_LABEL = { clone: "Cloning", scan: "Scanning" } as const

/** POST urls to /api/scan and stream progress; resolves with final results. */
export async function runScanStream(
  urls: string[],
  handlers: RunScanHandlers = {},
): Promise<ScanResult[]> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
    signal: handlers.signal,
  })

  // Non-stream error (validation, etc.) comes back as plain JSON.
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }

  const total = urls.length
  const results: ScanResult[] = []
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
      case "repo-start":
        currentFrac = 0
        label = total > 1 ? `Repo ${ev.index + 1}/${total}…` : "Preparing…"
        emit()
        break
      case "phase":
        // clone counts as the first slice of a repo; scan starts the scanner ramp
        currentFrac = ev.phase === "clone" ? 0.05 : 0.15
        label = `${PHASE_LABEL[ev.phase]}${total > 1 ? ` (${reposDone + 1}/${total})` : ""}…`
        emit()
        break
      case "scanner":
        // map scanner completion onto the 0.15→1.0 portion of this repo's slice
        if (ev.total > 0) currentFrac = 0.15 + 0.85 * (ev.completed / ev.total)
        label = ev.scanner ? `Scanning · ${ev.scanner}` : "Scanning…"
        emit()
        break
      case "repo-done":
        results.push({ url: ev.url, ok: ev.ok, report: ev.report, error: ev.error })
        reposDone++
        currentFrac = 0
        emit()
        break
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line) as ServerEvent)
      } catch {
        /* ignore malformed line */
      }
    }
  }

  return results
}
