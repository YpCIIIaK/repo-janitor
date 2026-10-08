"use client"

import { AlertTriangle, CheckCircle2, Cpu, Gauge, Ruler, XCircle } from "lucide-react"
import { categoryLabels, type Grade, type Issue, type IssueCategory, type Severity } from "@/lib/mock-data"
import {
  DEFAULT_WEIGHTS,
  SEVERITY_CURVE,
  issueCosts,
  type SeverityWeights,
} from "@/lib/score"
import { HISTORY_SCANNERS, SCANNER_INFO, scannerName } from "@/lib/scanner-info"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Diagnostics {
  completedScanners: string[]
  failedScanners: string[]
  history: "shallow" | "available" | "unavailable"
}

const SEVERITIES: Severity[] = ["critical", "warning", "info"]
const SEV_DOT: Record<Severity, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-sky-500",
}

const GRADE_BANDS: { grade: Grade; from: number; to: number }[] = [
  { grade: "F", from: 0, to: 40 },
  { grade: "D", from: 40, to: 60 },
  { grade: "C", from: 60, to: 75 },
  { grade: "B", from: 75, to: 90 },
  { grade: "A", from: 90, to: 100 },
]

const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))

/**
 * "Breakdown" tab — how the score was produced, as opposed to the Overview's
 * "what to do about it": every scanner and what it cost, the scoring rules
 * with this repo's weights, caveats about the scan itself, and issue density.
 */
export function BreakdownPanel({
  issues,
  weights = DEFAULT_WEIGHTS,
  diagnostics,
  linesOfCode,
  score,
}: {
  issues: Issue[]
  weights?: SeverityWeights
  diagnostics?: Diagnostics
  linesOfCode?: number
  score: number
}) {
  return (
    <div className="space-y-6">
      <ScannerTable issues={issues} weights={weights} diagnostics={diagnostics} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ScoringRules weights={weights} score={score} diagnostics={diagnostics} />
        <Density issues={issues} linesOfCode={linesOfCode} />
      </div>
    </div>
  )
}

function ScannerTable({
  issues,
  weights,
  diagnostics,
}: {
  issues: Issue[]
  weights: SeverityWeights
  diagnostics?: Diagnostics
}) {
  const costs = issueCosts(issues, weights)
  const rows = new Map<string, { counts: Record<Severity, number>; cost: number; total: number }>()
  const ensure = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      r = { counts: { critical: 0, warning: 0, info: 0 }, cost: 0, total: 0 }
      rows.set(id, r)
    }
    return r
  }
  for (const id of diagnostics?.completedScanners ?? []) ensure(id)
  for (const issue of issues) {
    const r = ensure(issue.scanner ?? "unknown")
    r.counts[issue.severity]++
    r.cost += costs.get(issue.id) ?? 0
    r.total++
  }
  const failed = diagnostics?.failedScanners ?? []
  for (const id of failed) rows.delete(id)

  const withFindings = [...rows.entries()].filter(([, r]) => r.total > 0).sort((a, b) => b[1].cost - a[1].cost)
  const clean = [...rows.entries()].filter(([, r]) => r.total === 0).map(([id]) => id).sort()
  const maxCost = Math.max(1, ...withFindings.map(([, r]) => r.cost))
  const ran = rows.size + failed.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="size-4 text-muted-foreground" />
          Scanners
        </CardTitle>
        <CardDescription>
          {ran > 0
            ? `${ran} checks ran: ${withFindings.length} found something, ${clean.length} came back clean${failed.length ? `, ${failed.length} failed` : ""}.`
            : "Which check produced each finding and how many points it cost."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {withFindings.length > 0 && (
          <ul className="divide-y divide-border">
            {withFindings.map(([id, r]) => (
              <li key={id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_140px_64px]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{scannerName(id)}</p>
                  {SCANNER_INFO[id] && (
                    <p className="truncate text-xs text-muted-foreground">{SCANNER_INFO[id].what}</p>
                  )}
                </div>
                <div className="col-start-1 flex items-center gap-2.5 text-xs tabular-nums text-muted-foreground sm:col-start-auto">
                  {SEVERITIES.filter((s) => r.counts[s] > 0).map((s) => (
                    <span key={s} className="flex items-center gap-1" title={s}>
                      <span className={cn("size-2 rounded-full", SEV_DOT[s])} />
                      {r.counts[s]}
                    </span>
                  ))}
                </div>
                <div className="row-span-2 row-start-1 flex flex-col items-end justify-center gap-1 sm:row-span-1 sm:row-start-auto">
                  <span className="text-sm font-semibold tabular-nums">−{fmt(r.cost)}</span>
                  <span className="h-1 w-12 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full bg-primary" style={{ width: `${(r.cost / maxCost) * 100}%` }} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {clean.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-success" />
              Clean
            </p>
            <div className="flex flex-wrap gap-1.5">
              {clean.map((id) => (
                <span
                  key={id}
                  title={SCANNER_INFO[id]?.what}
                  className="rounded-full border border-success/30 bg-success/5 px-2.5 py-1 text-xs"
                >
                  {scannerName(id)}
                </span>
              ))}
            </div>
          </div>
        )}

        {failed.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <XCircle className="size-3.5 text-destructive" />
              Failed — their findings are missing from the score
            </p>
            <div className="flex flex-wrap gap-1.5">
              {failed.map((id) => (
                <span key={id} className="rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs">
                  {scannerName(id)}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScoringRules({
  weights,
  score,
  diagnostics,
}: {
  weights: SeverityWeights
  score: number
  diagnostics?: Diagnostics
}) {
  const caveats: string[] = []
  if (diagnostics?.history === "shallow" || diagnostics?.history === "unavailable") {
    caveats.push(
      `Git history was ${diagnostics.history === "shallow" ? "shallow" : "not available"}: ${HISTORY_SCANNERS.map(scannerName).join(", ")} saw only part of the picture, and finding ages may be understated.`,
    )
  }
  if (diagnostics?.failedScanners.length) {
    caveats.push("Some scanners failed, so the real score may be lower than shown.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4 text-muted-foreground" />
          How the score works
        </CardTitle>
        <CardDescription>Start at 100 and subtract per finding. Weights below are the ones this scan used.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-xs">
          {SEVERITIES.map((s) => {
            const curve = SEVERITY_CURVE[s]
            return (
              <li key={s} className="flex items-start gap-2">
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", SEV_DOT[s])} />
                <span className="text-muted-foreground">
                  <span className="font-medium capitalize text-foreground">{s}</span> — {weights[s]} pts each for the
                  first {curve.full}, then each extra one costs less
                  {s === "info" && weights.infoCap !== undefined && `; never more than ${weights.infoCap} pts in total`}
                </span>
              </li>
            )
          })}
        </ul>

        <div>
          <div className="relative flex h-6 overflow-hidden rounded-md text-[10px] font-semibold">
            {GRADE_BANDS.map((b) => (
              <div
                key={b.grade}
                className={cn(
                  "flex items-center justify-center border-r border-background last:border-r-0",
                  score >= b.from && (score < b.to || b.to === 100) ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                )}
                style={{ width: `${b.to - b.from}%` }}
              >
                {b.grade}
              </div>
            ))}
          </div>
          <div className="relative mt-1 h-3 text-[10px] tabular-nums text-muted-foreground">
            {[40, 60, 75, 90].map((v) => (
              <span key={v} className="absolute -translate-x-1/2" style={{ left: `${v}%` }}>
                {v}
              </span>
            ))}
          </div>
        </div>

        {caveats.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            {caveats.map((c) => (
              <p key={c} className="flex gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                {c}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Density({ issues, linesOfCode }: { issues: Issue[]; linesOfCode?: number }) {
  const kloc = (linesOfCode ?? 0) / 1000
  const byCat = new Map<IssueCategory, number>()
  for (const i of issues) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1)
  const rows = [...byCat.entries()].map(([cat, n]) => ({ cat, n, d: kloc > 0 ? n / kloc : 0 })).sort((a, b) => b.d - a.d)
  const max = Math.max(0.0001, ...rows.map((r) => r.d))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ruler className="size-4 text-muted-foreground" />
          Density
        </CardTitle>
        <CardDescription>Findings per 1,000 lines of code — fair between small and large repositories.</CardDescription>
      </CardHeader>
      <CardContent>
        {kloc <= 0 ? (
          <p className="text-sm text-muted-foreground">No line count in this report — rescan to see density.</p>
        ) : (
          <>
            <p className="mb-4 text-3xl font-semibold tabular-nums">
              {(issues.length / kloc).toFixed(2)}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                per 1k lines · {Math.round(linesOfCode ?? 0).toLocaleString()} lines
              </span>
            </p>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.cat} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{categoryLabels[r.cat]}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full bg-chart-2" style={{ width: `${(r.d / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{r.d.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
