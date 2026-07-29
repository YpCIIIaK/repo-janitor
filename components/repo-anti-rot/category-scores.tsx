"use client"

import type { Issue, Grade } from "@/lib/mock-data"
import { categoryScores, categoryCosts, type SeverityWeights } from "@/lib/score"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Grade → chip style. Greens for healthy, amber for middling, red for failing.
const gradeStyle: Record<Grade, string> = {
  A: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  B: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  C: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  D: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  F: "bg-destructive/15 text-destructive border-destructive/30",
}

/** Round for display without printing a misleading "−0" for a real cost. */
function fmtCost(cost: number): string {
  if (cost === 0) return "0"
  const rounded = Math.round(cost * 100) / 100
  return rounded === 0 ? "<0.01" : String(rounded)
}

/**
 * Per-category sub-scores, plus the points each category is actually
 * responsible for.
 *
 * The sub-score answers "how healthy is this area on its own"; the cost answers
 * "what would I get back". They are different questions and used to be conflated
 * — a category can score a respectable B and still be the biggest single drag on
 * the total simply by holding more findings.
 */
export function CategoryScores({ issues, weights }: { issues: Issue[]; weights?: SeverityWeights }) {
  const scores = categoryScores(issues, weights)
  const costs = new Map(categoryCosts(issues, weights).map((c) => [c.category, c.cost]))
  if (scores.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Health by category</CardTitle>
        <CardDescription>
          Sub-score on its own, and the points it takes off the total.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {scores.map((s) => (
          <span
            key={s.category}
            title={`${s.label}: ${s.count} issue${s.count === 1 ? "" : "s"}, costing ${fmtCost(
              costs.get(s.category) ?? 0,
            )} points`}
            className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 py-1 pl-2.5 pr-1.5 text-xs"
          >
            <span className="text-foreground">{s.label}</span>
            <span className="font-mono tabular-nums text-destructive/80">
              −{fmtCost(costs.get(s.category) ?? 0)}
            </span>
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
