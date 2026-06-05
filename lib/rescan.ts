"use client"

import { saveReport, type ScanReport, type StoredRepo } from "@/lib/reports-store"
import { enrichReport, aiTargetCount } from "@/lib/ai-enrich"
import { readAiSettings, isAiEnabled } from "@/lib/ai-settings"
import { runScanStream } from "@/lib/scan-client"

/**
 * Shared re-scan pipeline used by the manual Rescan button AND the background
 * scheduler: clone → scan (streamed progress) → optional AI enrichment → persist.
 *
 * Keeping it in one place means both entry points apply the AI settings, progress
 * weighting and persistence identically.
 */

export interface RescanHooks {
  /** progress in [0,1] plus a human-readable status line */
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

/**
 * Re-scan a single stored repo and save the fresh report. Returns the saved
 * report, or `null` if the repo has no source URL (e.g. ingested from CI, so
 * there's nothing local to clone). Throws if the scan itself fails.
 */
export async function rescanRepo(repo: StoredRepo, hooks: RescanHooks = {}): Promise<ScanReport | null> {
  const url = repo.url
  if (!url) return null

  const aiOn = isAiEnabled(readAiSettings())
  const scanSpan = aiOn ? 0.8 : 1 // leave the last 20% for the AI pass when enabled

  const results = await runScanStream([url], {
    signal: hooks.signal,
    onProgress: (s) => hooks.onProgress?.(s.fraction * scanSpan, s.label),
  })

  const result = results[0]
  if (!result?.ok || !result.report) {
    throw new Error(result?.error ?? "Scan failed")
  }

  let report = result.report
  if (aiOn) {
    const total = aiTargetCount(report)
    hooks.onProgress?.(0.8, "AI analysis…")
    report = await enrichReport(report, {
      onProgress: (done) => hooks.onProgress?.(0.8 + 0.2 * (total > 0 ? done / total : 1), "AI analysis…"),
    })
  }

  saveReport(report, url)
  return report
}
