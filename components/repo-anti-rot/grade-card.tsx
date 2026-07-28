"use client"

import { Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Grade, Issue } from "@/lib/mock-data"
import { penaltyBreakdown, type SeverityWeights } from "@/lib/score"
import { severityStyle } from "@/lib/issue-format"
import { cn } from "@/lib/utils"

const gradeMeta: Record<Grade, { color: string; label: string }> = {
  A: { color: "var(--chart-1)", label: "Pristine" },
  B: { color: "var(--chart-2)", label: "Healthy" },
  C: { color: "var(--chart-2)", label: "Aging" },
  D: { color: "var(--chart-3)", label: "Rotting" },
  F: { color: "var(--chart-4)", label: "Critical decay" },
}

const severityNoun: Record<string, string> = {
  critical: "critical",
  warning: "warning",
  info: "notes",
}

export function GradeCard({
  grade,
  score,
  lastScan,
  issues,
  weights,
}: {
  grade: Grade
  score: number
  lastScan: string
  /** Optional: supply to show where the missing points went. */
  issues?: Issue[]
  weights?: SeverityWeights
}) {
  const meta = gradeMeta[grade]
  // Only tiers that actually cost something — a "−0 info" row is noise.
  const breakdown = issues ? penaltyBreakdown(issues, weights).filter((p) => p.penalty > 0) : []
  const circumference = 2 * Math.PI * 52
  const offset = circumference - (score / 100) * circumference

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-6">
        <div className="relative size-32">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={meta.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-4xl font-bold" style={{ color: meta.color }}>
              {grade}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{score}/100</span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            Scanned {lastScan}
          </p>
        </div>

        {/* Where the missing points went. The grade on its own says you have a
            problem; this says which pile of findings is the problem, which is
            the only version you can act on. */}
        {breakdown.length > 0 && (
          <div className="w-full space-y-1.5 border-t border-border pt-4">
            {breakdown.map((p) => (
              <div key={p.severity} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 font-medium tabular-nums",
                    severityStyle[p.severity],
                  )}
                >
                  {p.count}
                </span>
                <span className="text-muted-foreground">{severityNoun[p.severity]}</span>
                <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                  −{Number(p.penalty.toFixed(2))}
                  {/* A capped tier has stopped charging: more findings of this
                      kind cost nothing, which changes what you should do next. */}
                  {p.capped && <span className="ml-1 text-muted-foreground/60">(max)</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
