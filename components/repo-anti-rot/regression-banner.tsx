"use client"

import { ArrowRight, TrendingDown } from "lucide-react"
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

  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TrendingDown className="size-4 shrink-0 text-destructive" />
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
