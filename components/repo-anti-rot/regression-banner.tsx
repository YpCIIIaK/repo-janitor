"use client"

import { ArrowLeftRight, ArrowRight, TrendingDown } from "lucide-react"
import { buildRegressionStory, toStoryIssues } from "@repo-anti-rot/core"
import type { StoredRepo } from "@/lib/reports-store"
import { scoreToGrade } from "@/lib/score"
import { Button } from "@/components/ui/button"
import { severityStyle } from "@/lib/issue-format"
import { cn } from "@/lib/utils"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * Compact scan-over-scan story on Overview: headline + a few new titles → Issues.
 * Same wording as watch mail / Action PR via {@link buildRegressionStory}.
 */
export function RegressionBanner({
  repo,
  liveScore,
  liveGrade,
  onViewIssues,
}: {
  repo: StoredRepo
  liveScore: number
  liveGrade: string
  onViewIssues: () => void
}) {
  const { t } = useLocale()

  const prevPoint = repo.history.length > 1 ? repo.history[repo.history.length - 2] : undefined
  const prevIds = repo.prevIssues?.map((i) => i.id) ?? repo.prevIssueIds
  if (!prevPoint || !prevIds) return null

  const story = buildRegressionStory(
    {
      score: prevPoint.score,
      grade: scoreToGrade(prevPoint.score),
      issueIds: prevIds,
    },
    {
      score: liveScore,
      grade: liveGrade,
      issues: toStoryIssues(repo.latest.issues),
    },
    { newCap: 3 },
  )

  // Banner is for "something moved" — new findings or a score drop. Pure
  // improvements without new issues stay in the header chips only.
  if (story.added === 0 && story.scoreDelta >= 0) return null

  /**
   * The alarm is for the score falling, not for the banner existing.
   *
   * Four findings appearing while four others are fixed leaves the score where
   * it was, and dressing that in a red border and a falling arrow tells a reader
   * their project got worse when it did not — the exact misreading this tool is
   * supposed to catch elsewhere. The findings still get listed either way, since
   * new issues are news whatever the arithmetic did; only the chrome changes.
   */
  const dropped = story.scoreDelta < 0
  const Icon = dropped ? TrendingDown : ArrowLeftRight

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        dropped ? "border-destructive/25 bg-destructive/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Icon
              className={cn(
                "size-4 shrink-0",
                dropped ? "text-destructive" : "text-muted-foreground",
              )}
            />
            <span className="font-mono text-[13px] tabular-nums">{story.headline}</span>
          </p>
          {story.newFindings.length > 0 && (
            <ul className="space-y-1">
              {story.newFindings.map((f) => (
                <li key={f.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-0.5 font-medium capitalize",
                      severityStyle[f.severity],
                    )}
                  >
                    {f.severity}
                  </span>
                  <span className="truncate text-muted-foreground">{f.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onViewIssues}>
          {t("app.regressionViewIssues")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
