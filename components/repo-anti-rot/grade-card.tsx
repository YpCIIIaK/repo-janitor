"use client"

import { Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Grade, Issue } from "@/lib/mock-data"
import { GRADE_CSS_VAR, GRADE_LABEL } from "@/lib/grade-style"
import { penaltyBreakdown, type SeverityWeights } from "@/lib/score"
import { severityStyle } from "@/lib/issue-format"
import { cn } from "@/lib/utils"
import { Gauge } from "@/components/charts/gauge"

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
  scope,
}: {
  grade: Grade
  score: number
  lastScan: string
  /** Optional: supply to show where the missing points went. */
  issues?: Issue[]
  weights?: SeverityWeights
  /** "1,240 files · 182,431 lines" — what a clean result is clean across. */
  scope?: string | null
}) {
  const color = GRADE_CSS_VAR[grade]
  // Only tiers that actually cost something — a "−0 info" row is noise.
  const breakdown = issues ? penaltyBreakdown(issues, weights).filter((p) => p.penalty > 0) : []

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-6">
        {/* An open 270° arc rather than the closed ring this used to draw: a full
            circle reads as complete at every value, so a bad score still looked
            like a finished thing. The gap gives the needle somewhere to be. */}
        <Gauge value={score} size={168} thickness={14} color={color}>
          <span className="font-mono text-4xl font-bold leading-none" style={{ color }}>
            {grade}
          </span>
          <span className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            {score}/100
          </span>
        </Gauge>

        <div className="text-center">
          <p className="text-sm font-medium">{GRADE_LABEL[grade]}</p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            Scanned {lastScan}
          </p>
        </div>

        {/* With nothing costing points there is no breakdown to draw, and the
            card used to simply stop — a good result got less on screen than a
            bad one, which is backwards. This says what the clean result covers,
            in the only terms the scan can back. */}
        {breakdown.length === 0 && (
          <div className="w-full border-t border-border pt-4">
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              No secrets, known vulnerabilities, end-of-life runtimes or workflow
              security issues found{scope ? ` across ${scope}` : ""}.
            </p>
          </div>
        )}

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
                  {/* Past its threshold a tier charges less for each additional
                      finding — still something, which is what separates this from
                      the cap it replaced. */}
                  {p.discounted && <span className="ml-1 text-muted-foreground/60">(tapered)</span>}
                </span>
              </div>
            ))}
            {/* Without this, the per-finding numbers elsewhere look wrong: inside
                a tapered tier they are a share of a total that grows more slowly
                than the count, so fixing one hands part of its points to the rest. */}
            {breakdown.some((p) => p.discounted) && (
              <p className="pt-1 text-[11px] leading-snug text-muted-foreground/70">
                Past a few findings, each additional one in a tier costs less than
                the last — never nothing, so clearing any of them still helps.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
