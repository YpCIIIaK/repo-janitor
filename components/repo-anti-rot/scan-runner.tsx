"use client"

import { useState } from "react"
import {
  Loader2,
  Play,
  AlertTriangle,
  GitBranch,
  Download,
  FileJson,
  Clock,
  Maximize2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RepoPicker, useInitialUrl, type SelectedRepo } from "./repo-picker"
import { BatchSummaryCard, repoAnchor } from "./batch-summary"
import { summariseBatch } from "@/lib/multi-report"
import { cn } from "@/lib/utils"
import { saveReport, type ScanReport as StoredScanReport } from "@/lib/reports-store"
import { enrichReport, aiTargetCount } from "@/lib/ai-enrich"
import { readAiSettings, isAiEnabled } from "@/lib/ai-settings"
import { runScanStream } from "@/lib/scan-client"
import { refreshPublishedShare } from "@/lib/share-refresh"
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import { Progress } from "@/components/ui/progress"
import { FamousRepos } from "./famous-repos"
import { ScannerPicker } from "./scanner-picker"
import { useLocale } from "@/components/i18n/locale-provider"
import { formatDebtHours, HOURS_PER_SEVERITY } from "@/lib/debt-hours"
import {
  loadScannerSelection,
  onlyForRequest,
  saveScannerSelection,
} from "@/lib/scan-selection"

type Grade = "A" | "B" | "C" | "D" | "F"
type Severity = "critical" | "warning" | "info"
type IssueCategory = "env" | "dependency" | "branch" | "todo" | "security" | "dead-code" | "hygiene"

interface Issue {
  id: string
  category: IssueCategory
  severity: Severity
  title: string
  location: string
  ageDays: number
  detail: string
  aiNote?: string
}

interface ScanReport {
  schemaVersion: number
  repo: { owner: string; name: string; defaultBranch: string }
  generatedAt: string
  score: number
  grade: Grade
  issues: Issue[]
  /** HEAD SHA when the scanner recorded it — used as the watch baseline. */
  commit?: string
  profile?: { languages?: { language?: string; loc?: number }[] }
}

interface ScanResult {
  url: string
  ok: boolean
  report?: ScanReport
  error?: string
}

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

function formatTimestamp(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** Trigger a browser download for an in-memory string. */
function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Compact post-scan card — grade + severity + one CTA into the dashboard.
 * Detail (findings, watch, share, percentile) stays in the full app so this
 * dialog fits one viewport and people open the dashboard on purpose.
 */
function ResultCard({ result, onOpen }: { result: ScanResult; onOpen?: (repoId: string) => void }) {
  const { t } = useLocale()

  if (!result.ok || !result.report) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{result.url}</p>
            <p className="mt-1 break-words text-xs text-destructive">{result.error ?? t("scan.failed")}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const report = result.report
  const { repo, grade, score, issues, generatedAt } = report
  const slug = `${repo.owner}-${repo.name}`.replace(/[^a-z0-9._-]+/gi, "-")
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  }
  const debtHours = issues.reduce((s, i) => s + (HOURS_PER_SEVERITY[i.severity] ?? 0), 0)
  const repoId = `${repo.owner}/${repo.name}`

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {repo.owner}/{repo.name}
          </span>
        </CardTitle>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{score}/100</span>
          <span
            className="flex size-8 items-center justify-center rounded-md font-mono text-sm font-bold"
            style={{
              color: GRADE_CSS_VAR[grade],
              backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[grade]} 15%, transparent)`,
            }}
          >
            {grade}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" />
            {repo.defaultBranch}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatTimestamp(generatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.critical)}>
            {counts.critical} {t("issues.critical")}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.warning)}>
            {counts.warning} {t("issues.warning")}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.info)}>
            {counts.info} {t("issues.info")}
          </span>
          {issues.length > 0 && (
            <span className="text-muted-foreground">
              {t("scan.debtHint", { debt: formatDebtHours(debtHours) })}
            </span>
          )}
        </div>

        {issues.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("scan.clean")}</p>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("scan.resultLead")}</p>

        <div className="flex flex-wrap items-center gap-2">
          {onOpen && (
            <Button size="sm" onClick={() => onOpen(repoId)}>
              <Maximize2 className="size-4" />
              {t("scan.openDashboard")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadFile(
                `${slug}.repo-anti-rot.json`,
                JSON.stringify(report, null, 2),
                "application/json",
              )
            }
          >
            <FileJson className="size-4" />
            {t("scan.downloadJson")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ScanRunner({ onOpen }: { onOpen?: (repoId: string) => void }) {
  const { t } = useLocale()
  const [selected, setSelected] = useState<SelectedRepo[]>([])
  const [scannerIds, setScannerIds] = useState<string[]>(() => loadScannerSelection())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 overall
  const [progressLabel, setProgressLabel] = useState("")
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A shared link lands here with ?url=…; it goes into the list like anything
  // else, so the same rule holds — what gets scanned is what is shown.
  useInitialUrl((url) => setSelected((prev) => (prev.length ? prev : [{ url }])))

  const urls = selected.map((s) => s.url)

  const okResults = results?.filter((r) => r.ok && r.report) ?? []

  function onScannersChange(ids: string[]) {
    setScannerIds(ids)
    saveScannerSelection(ids)
  }

  function downloadAll() {
    const reports = okResults.map((r) => r.report)
    downloadFile("repo-anti-rot-batch.json", JSON.stringify(reports, null, 2), "application/json")
  }

  async function runScan() {
    setLoading(true)
    setError(null)
    setResults(null)
    setProgress(0)
    setProgressLabel(t("scan.starting"))

    // Reserve the last 20% of the bar for the AI pass when it's enabled.
    const aiOn = isAiEnabled(readAiSettings())
    const scanSpan = aiOn ? 0.8 : 1
    const only = onlyForRequest(scannerIds)

    try {
      const scanResults = (await runScanStream(urls, {
        only,
        onProgress: (s) => {
          setProgress(s.fraction * scanSpan)
          setProgressLabel(s.label)
        },
      })) as unknown as ScanResult[]
      setResults(scanResults)

      const succeeded = scanResults.filter((r) => r.ok && r.report)

      if (aiOn) {
        // Enrich each report, mapping completion onto the final 80%→100% slice.
        const totals = succeeded.map((r) => aiTargetCount(r.report as StoredScanReport))
        const grand = totals.reduce((a, b) => a + b, 0)
        let doneGlobal = 0
        setProgressLabel("AI analysis…")
        for (let i = 0; i < succeeded.length; i++) {
          const r = succeeded[i]
          const report = (await enrichReport(r.report as StoredScanReport, {
            onProgress: (done) => {
              const frac = grand > 0 ? (doneGlobal + done) / grand : 1
              setProgress(0.8 + 0.2 * frac)
            },
          })) as unknown as ScanReport
          doneGlobal += totals[i]
          r.report = report
          saveReport(report as StoredScanReport, r.url)
          await refreshPublishedShare(report, r.url).catch(() => "failed")
        }
      } else {
        for (const r of succeeded) {
          saveReport(r.report as StoredScanReport, r.url)
          await refreshPublishedShare(r.report, r.url).catch(() => "failed")
        }
      }

      setProgress(1)
      setResults([...scanResults])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/80 shadow-lg shadow-primary/5 ring-1 ring-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("scan.formTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("scan.formLead")}</p>

          <RepoPicker selected={selected} onChange={setSelected} disabled={loading} />

          <FamousRepos selected={selected} onChange={setSelected} disabled={loading} />

          <ScannerPicker
            selected={scannerIds}
            onChange={onScannersChange}
            disabled={loading}
          />

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              {selected.length === 0
                ? t("repo.searchHint")
                : t("scan.willScan", { count: selected.length })}
            </span>
            <Button onClick={runScan} disabled={loading || urls.length === 0}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("scan.running")}
                </>
              ) : (
                <>
                  <Play className="size-4" />
                  {selected.length > 1
                    ? t("scan.runCount", { count: selected.length })
                    : t("scan.run")}
                </>
              )}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {loading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{progressLabel || t("scan.working")}</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <Progress value={progress * 100} />
        </div>
      )}

      {results && (
        <div className="space-y-3">
          {results.length > 1 && (
            <>
              <BatchSummaryCard
                summary={summariseBatch(
                  results as unknown as Parameters<typeof summariseBatch>[0],
                )}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("scan.summary", { total: results.length, ok: okResults.length })}
                </p>
                <Button variant="outline" size="sm" onClick={downloadAll}>
                  <Download className="size-4" />
                  {t("scan.downloadAll")}
                </Button>
              </div>
            </>
          )}
          {results.map((r) => (
            <div
              key={r.url}
              id={r.report ? repoAnchor(`${r.report.repo.owner}/${r.report.repo.name}`) : undefined}
              className="scroll-mt-4"
            >
              <ResultCard result={r} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
