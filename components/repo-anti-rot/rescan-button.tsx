"use client"

import { useState } from "react"
import { Loader2, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { saveReport, type StoredRepo } from "@/lib/reports-store"
import { enrichReport, aiTargetCount } from "@/lib/ai-enrich"
import { readAiSettings, isAiEnabled } from "@/lib/ai-settings"
import { runScanStream } from "@/lib/scan-client"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/**
 * Re-runs a stored repo through the streaming `/api/scan` and appends a fresh
 * point to its history — this is what turns the dashboard from a one-shot linter
 * into a monitor. Shows real progress (clone → each scanner → AI). Disabled for
 * repos with no source URL (e.g. ingested from CI): nothing local to clone.
 */
export function RescanButton({ repo, className }: { repo: StoredRepo; className?: string }) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const [progressLabel, setProgressLabel] = useState("")
  const [error, setError] = useState<string | null>(null)
  const url = repo.url

  async function rescan() {
    if (!url) return
    setLoading(true)
    setError(null)
    setProgress(0)
    setProgressLabel("Starting…")

    const aiOn = isAiEnabled(readAiSettings())
    const scanSpan = aiOn ? 0.8 : 1

    try {
      const results = await runScanStream([url], {
        onProgress: (s) => {
          setProgress(s.fraction * scanSpan)
          setProgressLabel(s.label)
        },
      })
      const result = results[0]
      if (result?.ok && result.report) {
        if (aiOn) {
          const total = aiTargetCount(result.report)
          setProgressLabel("AI analysis…")
          const report = await enrichReport(result.report, {
            onProgress: (done) => setProgress(0.8 + 0.2 * (total > 0 ? done / total : 1)),
          })
          saveReport(report, url)
        } else {
          saveReport(result.report, url)
        }
        setProgress(1)
      } else {
        setError(result?.error ?? "Scan failed")
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <Button
        size="sm"
        variant="outline"
        onClick={rescan}
        disabled={loading || !url}
        title={url ? `Re-scan ${url}` : "No source URL — this repo was ingested, not scanned locally"}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
        {loading ? "Rescanning…" : "Rescan"}
      </Button>
      {loading && (
        <div className="w-[200px] space-y-1">
          <Progress value={progress * 100} className="h-1.5" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">{progressLabel}</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
        </div>
      )}
      {error && <span className="max-w-[220px] truncate text-xs text-destructive">{error}</span>}
    </div>
  )
}
