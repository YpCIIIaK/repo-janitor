"use client"

import type { Issue, Grade } from "@/lib/mock-data"
import { categoryScores, type SeverityWeights } from "@/lib/score"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Grade → chip style. Greens for healthy, amber for middling, red for failing.
const gradeStyle: Record<Grade, string> = {
  A: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  B: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  C: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  D: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  F: "bg-destructive/15 text-destructive border-destructive/30",
}

/** Compact strip of per-category sub-scores (only categories with findings). */
export function CategoryScores({ issues, weights }: { issues: Issue[]; weights?: SeverityWeights }) {
  const scores = categoryScores(issues, weights)
  if (scores.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Health by category</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {scores.map((s) => (
          <span
            key={s.category}
            title={`${s.label}: ${s.count} issue${s.count === 1 ? "" : "s"}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 py-1 pl-2.5 pr-1.5 text-xs"
          >
            <span className="text-foreground">{s.label}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{s.score}</span>
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-md border text-[11px] font-semibold",
                gradeStyle[s.grade],
              )}
            >
              {s.grade}
            </span>
          </span>
        ))}
      </CardContent>
    </Card>
  )
}
