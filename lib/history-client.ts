"use client"

import type { ScanReport } from "@/lib/reports-store"

/**
 * Client for the streaming `/api/scan/history` endpoint.
 *
 * The server clones a repo's history, samples commits, and scans each — streaming
 * NDJSON as it goes. We parse it line-by-line: the `commits` event arrives first
 * (so the tree can render immediately), then a `node` event per scanned commit
 * fills in its report and diff. Callbacks fire in real time; the promise resolves
 * when the stream ends.
 */

export interface CommitSkeleton {
  sha: string
  shortSha: string
  date: number
  parents: string[]
  subject: string
  tagged: boolean
}

export interface CommitNode {
  report: ScanReport
  diffVsParent: { added: number; fixed: number; hasParent: boolean }
  cached: boolean
}

type HistoryEvent =
  | { type: "start"; url: string }
  | { type: "commits"; commits: CommitSkeleton[] }
  | { type: "node"; sha: string; node: CommitNode }
  | { type: "node-error"; sha: string; error: string }
  | { type: "done" }
  | { type: "error"; error: string }

export interface StreamHistoryHandlers {
  /** the sampled commit skeleton, sent up front so the graph can render early */
  onCommits?: (commits: CommitSkeleton[]) => void
  /** a scanned commit's full report + diff vs the previous (older) scanned node */
  onNode?: (sha: string, node: CommitNode) => void
  /** a commit that failed to scan (checkout/scan error) */
  onNodeError?: (sha: string, error: string) => void
  signal?: AbortSignal
}

/** How many commits to scan: a fixed sample budget, or every commit in the history. */
export type HistoryScope = { all: true } | { all?: false; sample: number }

/** POST a repo URL to /api/scan/history and stream the per-commit scan tree. */
export async function streamHistory(
  url: string,
  scope: HistoryScope,
  handlers: StreamHistoryHandlers = {},
): Promise<void> {
  const body = scope.all ? { url, all: true } : { url, sample: scope.sample }
  const res = await fetch("/api/scan/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }

  const handle = (ev: HistoryEvent) => {
    switch (ev.type) {
      case "commits":
        handlers.onCommits?.(ev.commits)
        break
      case "node":
        handlers.onNode?.(ev.sha, ev.node)
        break
      case "node-error":
        handlers.onNodeError?.(ev.sha, ev.error)
        break
      case "error":
        throw new Error(ev.error)
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
      handle(JSON.parse(line) as HistoryEvent)
    }
  }
}
