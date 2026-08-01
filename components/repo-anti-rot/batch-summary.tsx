"use client"

import { AlertTriangle, Download, Layers, TrendingDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { batchToMarkdown, type BatchSummary } from "@/lib/multi-report"
import { categoryLabels } from "@/lib/mock-data"
import { gradeBadgeClass } from "@/lib/grade-style"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * The batch, read as one thing.
 *
 * Shown above the individual reports when more than one repository was scanned,
 * because the two questions a batch raises — which is worst, and what is wrong
 * with all of them — cannot be answered by reading five cards in a row.
 *
 * Everything here is a summary of reports already on screen. Clicking a row
 * scrolls to that repository's full card rather than opening anything new: one
 * set of facts, two levels of zoom.
 */

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-destructive",
  warning: "text-chart-2",
  info: "text-muted-foreground",
}

/** Stable anchor for a repository's own card, so a row can scroll to it. */
export function repoAnchor(fullName: string): string {
  return `repo-${fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function BatchSummaryCard({ summary }: { summary: BatchSummary }) {
  const { t } = useLocale()
  if (summary.repos.length + summary.failures.length < 2) return null

  const { counts, totalFindings } = summary

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-primary" />
          {t("batch.title", { count: summary.repos.length })}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            download("repo-anti-rot-batch.md", batchToMarkdown(summary), "text/markdown")
          }
        >
          <Download className="size-4" />
          {t("batch.downloadMarkdown")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Headline numbers. Findings first: the score is a summary of them. */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{totalFindings}</p>
            <p className="text-xs text-muted-foreground">{t("batch.findings")}</p>
          </div>
          <div className="flex gap-3 text-sm">
            {(["critical", "warning", "info"] as const).map((sev) => (
              <span key={sev} className={SEVERITY_TONE[sev]}>
                <span className="font-semibold tabular-nums">{counts[sev]}</span>{" "}
                {t(`issues.${sev}` as "issues.critical")}
              </span>
            ))}
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{summary.averageScore}</p>
            <p className="text-xs text-muted-foreground">{t("batch.averageScore")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {summary.gradeSpread.map(({ grade, count }) => (
              <span
                key={grade}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                  gradeBadgeClass(grade),
                )}
              >
                {count}× {grade}
              </span>
            ))}
          </div>
        </div>

        {/* Worst first — the order you would work through them. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-medium">{t("batch.repository")}</th>
                <th className="pb-2 font-medium">{t("batch.grade")}</th>
                <th className="pb-2 text-right font-medium">{t("batch.score")}</th>
                <th className="pb-2 text-right font-medium">{t("issues.critical")}</th>
                <th className="pb-2 text-right font-medium">{t("issues.warning")}</th>
                <th className="pb-2 pr-3 text-right font-medium">{t("issues.info")}</th>
                <th className="pb-2 pl-3 font-medium">{t("batch.mostly")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.repos.map((repo) => (
                <tr
                  key={repo.fullName}
                  onClick={() =>
                    document
                      .getElementById(repoAnchor(repo.fullName))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
                >
                  <td className="py-2 pr-3">
                    <span className="text-muted-foreground">{repo.owner}/</span>
                    <span className="font-medium">{repo.name}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded border font-mono text-xs font-bold",
                        gradeBadgeClass(repo.grade),
                      )}
                    >
                      {repo.grade}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{repo.score}</td>
                  <td className={cn("py-2 pr-3 text-right tabular-nums", repo.counts.critical > 0 && SEVERITY_TONE.critical)}>
                    {repo.counts.critical}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {repo.counts.warning}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {repo.counts.info}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted-foreground">
                    {repo.topCategory ? categoryLabels[repo.topCategory] : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The part a single report cannot tell you. */}
        {summary.shared.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="size-4 text-chart-2" />
              <p className="text-sm font-medium">{t("batch.sharedTitle")}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t("batch.sharedLead")}</p>
            <ul className="space-y-1.5 pt-1">
              {summary.shared.slice(0, 8).map((finding) => (
                <li key={`${finding.category}-${finding.title}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className={cn("text-xs", SEVERITY_TONE[finding.severity])}>●</span>
                  <span>{finding.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("batch.inRepos", { count: finding.repos.length })} ·{" "}
                    {finding.repos.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.failures.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <p className="text-sm font-medium">
                {t("batch.failedTitle", { count: summary.failures.length })}
              </p>
            </div>
            {summary.failures.map((failure) => (
              <p key={failure.url} className="break-words text-xs text-muted-foreground">
                <span className="font-mono">{failure.url}</span> — {failure.error}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
