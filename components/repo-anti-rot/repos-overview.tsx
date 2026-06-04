"use client"

import { GitBranch, ArrowRight } from "lucide-react"
import type { Grade } from "@/lib/mock-data"
import {
  countSeverity,
  issueDensity,
  portfolioTrend,
  timeAgo,
  type StoredRepo,
} from "@/lib/reports-store"
import { Card } from "@/components/ui/card"
import { PortfolioTrend } from "@/components/repo-anti-rot/portfolio-trend"
import { cn } from "@/lib/utils"

const gradeColor: Record<Grade, string> = {
  A: "text-primary border-primary/30 bg-primary/10",
  B: "text-chart-2 border-chart-2/30 bg-chart-2/10",
  C: "text-chart-2 border-chart-2/30 bg-chart-2/10",
  D: "text-chart-3 border-chart-3/30 bg-chart-3/10",
  F: "text-destructive border-destructive/30 bg-destructive/10",
}

const severityChip: Record<"critical" | "warning" | "info", string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

/**
 * A bird's-eye grid of every scanned repo — grades, scores and issue mix at a
 * glance, plus a portfolio summary up top. Clicking a card drills into that
 * repo's dashboard.
 */
export function ReposOverview({
  repos,
  onSelect,
}: {
  repos: StoredRepo[]
  onSelect: (id: string) => void
}) {
  const total = repos.length
  const avgScore =
    total === 0 ? 0 : Math.round(repos.reduce((sum, r) => sum + r.latest.score, 0) / total)
  const totalCritical = repos.reduce(
    (sum, r) => sum + countSeverity(r.latest.issues, "critical"),
    0,
  )
  const totalIssues = repos.reduce((sum, r) => sum + r.latest.issues.length, 0)
  const trend = portfolioTrend(repos)

  const summary = [
    { label: "Repositories", value: String(total) },
    { label: "Avg score", value: String(avgScore) },
    { label: "Open issues", value: String(totalIssues) },
    {
      label: "Critical",
      value: String(totalCritical),
      tone: totalCritical > 0 ? "text-destructive" : undefined,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">All repositories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Portfolio health across every scanned repo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="gap-1 p-4">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className={cn("font-mono text-2xl font-semibold tabular-nums", s.tone)}>
              {s.value}
            </span>
          </Card>
        ))}
      </div>

      {trend.length >= 2 && <PortfolioTrend data={trend} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {repos.map((repo) => {
          const counts = {
            critical: countSeverity(repo.latest.issues, "critical"),
            warning: countSeverity(repo.latest.issues, "warning"),
            info: countSeverity(repo.latest.issues, "info"),
          }
          const density = issueDensity(repo, repo.latest.issues.length)
          return (
            <button
              key={repo.id}
              onClick={() => onSelect(repo.id)}
              className="group text-left"
            >
              <Card className="h-full gap-3 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-md border font-mono text-base font-semibold",
                      gradeColor[repo.latest.grade],
                    )}
                  >
                    {repo.latest.grade}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="text-muted-foreground">{repo.owner}/</span>
                      {repo.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <GitBranch className="size-3 shrink-0" />
                      <span className="truncate">{repo.defaultBranch}</span>
                      <span className="text-muted-foreground/50">·</span>
                      <span>{timeAgo(repo.scannedAt)}</span>
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex gap-1 text-[10px]">
                    {(["critical", "warning", "info"] as const).map((sev) => (
                      <span
                        key={sev}
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 font-medium tabular-nums",
                          severityChip[sev],
                          counts[sev] === 0 && "opacity-40",
                        )}
                      >
                        {counts[sev]} {sev}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {density && (
                      <span
                        className="font-mono text-xs tabular-nums text-muted-foreground"
                        title={`${density.loc.toLocaleString()} lines of code`}
                      >
                        {density.perKloc.toFixed(1)}/kLOC
                      </span>
                    )}
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {repo.latest.score}
                    </span>
                  </div>
                </div>
              </Card>
            </button>
          )
        })}
      </div>
    </div>
  )
}
