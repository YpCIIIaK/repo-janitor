"use client"

import { useState } from "react"
import {
  Loader2,
  Play,
  AlertTriangle,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Download,
  FileJson,
  FileText,
  Clock,
  Check,
  Copy,
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
import { Progress } from "@/components/ui/progress"
import { ShareBox } from "./share-box"
import { useLocale } from "@/components/i18n/locale-provider"

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
}

interface ScanResult {
  url: string
  ok: boolean
  report?: ScanReport
  error?: string
}

const gradeColor: Record<Grade, string> = {
  A: "var(--chart-1)",
  B: "var(--chart-2)",
  C: "var(--chart-2)",
  D: "var(--chart-3)",
  F: "var(--chart-4)",
}

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

const categoryLabels: Record<IssueCategory, string> = {
  env: "Env Lifecycle",
  dependency: "Dependency Funeral",
  branch: "Stale Branch",
  todo: "TODO Debt",
  security: "Security",
  "dead-code": "Dead Code",
  hygiene: "Hygiene",
}

function formatAge(days: number) {
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  return `${days}d`
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

function reportToMarkdown(report: ScanReport): string {
  const { repo, grade, score, generatedAt, issues } = report
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  }
  const lines: string[] = [
    `# Repo Anti-Rot report — ${repo.owner}/${repo.name}`,
    "",
    `- **Grade:** ${grade} (${score}/100)`,
    `- **Default branch:** ${repo.defaultBranch}`,
    `- **Scanned:** ${formatTimestamp(generatedAt)}`,
    `- **Issues:** ${counts.critical} critical · ${counts.warning} warning · ${counts.info} info`,
    "",
  ]
  if (issues.length === 0) {
    lines.push("No issues detected — clean scan. ✅", "")
  } else {
    lines.push("## Issues", "")
    for (const i of issues) {
      lines.push(
        `### [${i.severity.toUpperCase()}] ${i.title}`,
        "",
        `- **Category:** ${categoryLabels[i.category] ?? i.category}`,
        `- **Location:** \`${i.location}\``,
        `- **Age:** ${formatAge(i.ageDays)}`,
        "",
        i.detail,
        "",
      )
    }
  }
  return lines.join("\n")
}

function ResultCard({ result, onOpen }: { result: ScanResult; onOpen?: (repoId: string) => void }) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be unavailable (insecure context) — fall back to download
      downloadFile(`${slug}.repo-anti-rot.json`, JSON.stringify(report, null, 2), "application/json")
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
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
            style={{ color: gradeColor[grade], backgroundColor: `color-mix(in oklab, ${gradeColor[grade]} 15%, transparent)` }}
          >
            {grade}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Metadata */}
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

        {/* Severity counts */}
        <div className="flex gap-2 text-xs">
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.critical)}>
            {counts.critical} {t("issues.critical")}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.warning)}>
            {counts.warning} {t("issues.warning")}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5", severityStyle.info)}>
            {counts.info} {t("issues.info")}
          </span>
        </div>

        {/* Issues — expandable rows with full detail */}
        {issues.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border">
            {issues.map((issue) => {
              const open = expanded === issue.id
              return (
                <div key={issue.id}>
                  <button
                    onClick={() => setExpanded(open ? null : issue.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "hidden w-16 shrink-0 rounded-full border px-2 py-0.5 text-center text-[10px] font-medium uppercase sm:inline-block",
                        severityStyle[issue.severity],
                      )}
                    >
                      {issue.severity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{issue.title}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{issue.location}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                      {categoryLabels[issue.category]}
                    </span>
                    <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatAge(issue.ageDays)}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-2 bg-secondary/40 px-4 pb-4 pl-11 pt-1 text-sm text-muted-foreground">
                      <p>{issue.detail}</p>
                      {issue.aiNote && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                          <div className="mb-1 text-xs font-medium text-primary">AI analysis</div>
                          <p className="text-foreground/90">{issue.aiNote}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
                        <span>category: {categoryLabels[issue.category]}</span>
                        <span>location: {issue.location}</span>
                        <span>age: {formatAge(issue.ageDays)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="rounded-md border border-border py-6 text-center text-sm text-muted-foreground">
            {t("scan.clean")}
          </p>
        )}

        {/* Export actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {onOpen && (
            <Button size="sm" onClick={() => onOpen(`${repo.owner}/${repo.name}`)}>
              <Maximize2 className="size-4" />
              {t("scan.openDashboard")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadFile(`${slug}.repo-anti-rot.json`, JSON.stringify(report, null, 2), "application/json")}
          >
            <FileJson className="size-4" />
            {t("scan.downloadJson")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadFile(`${slug}.repo-anti-rot.md`, reportToMarkdown(report), "text/markdown")}
          >
            <FileText className="size-4" />
            {t("scan.downloadMarkdown")}
          </Button>
          <Button variant="ghost" size="sm" onClick={copyJson}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t("scan.copied") : t("scan.copyJson")}
          </Button>
        </div>

        {/* Opt-in publishing. Deliberately below the results: the user decides
            after seeing what they would be sharing, not before. */}
        <ShareBox report={report} repoUrl={result.url} />
      </CardContent>
    </Card>
  )
}

export function ScanRunner({ onOpen }: { onOpen?: (repoId: string) => void }) {
  const { t } = useLocale()
  const [selected, setSelected] = useState<SelectedRepo[]>([])
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

    try {
      const scanResults = (await runScanStream(urls, {
        onProgress: (s) => {
          setProgress(s.fraction * scanSpan)
          setProgressLabel(s.label)
        },
      })) as unknown as ScanResult[]
      setResults(scanResults)

      const okResults = scanResults.filter((r) => r.ok && r.report)

      if (aiOn) {
        // Enrich each report, mapping completion onto the final 80%→100% slice.
        const totals = okResults.map((r) => aiTargetCount(r.report as StoredScanReport))
        const grand = totals.reduce((a, b) => a + b, 0)
        let doneGlobal = 0
        setProgressLabel("AI analysis…")
        for (let i = 0; i < okResults.length; i++) {
          const r = okResults[i]
          const report = (await enrichReport(r.report as StoredScanReport, {
            onProgress: (done) => {
              const frac = grand > 0 ? (doneGlobal + done) / grand : 1
              setProgress(0.8 + 0.2 * frac)
            },
          })) as unknown as ScanReport
          doneGlobal += totals[i]
          r.report = report // reflect notes in the on-screen result cards too
          saveReport(report as StoredScanReport, r.url)
        }
      } else {
        for (const r of okResults) saveReport(r.report as StoredScanReport, r.url)
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
    <div className="space-y-6">
      {/* Elevated: on the landing page this card is the one thing to do, and it
          has to read as the focus rather than as the first of several panels. */}
      <Card className="border-border/80 shadow-lg shadow-primary/5 ring-1 ring-primary/5">
        <CardHeader>
          <CardTitle className="text-base">{t("scan.formTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("scan.formLead")}</p>

          <RepoPicker selected={selected} onChange={setSelected} disabled={loading} />

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
        <div className="space-y-4">
          {results.length > 1 && (
            <>
              {/* The batch as one thing, above the individual reports. Reading
                  five cards in a row does not answer "which is worst" or "what
                  is wrong with all of them". */}
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
              // Scroll target for the summary table, so a row leads to the full
              // report rather than to a second copy of the same numbers.
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
