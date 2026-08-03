"use client"

import { Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Grade, Issue } from "@/lib/mock-data"
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import { penaltyBreakdown, type SeverityWeights } from "@/lib/score"
import { Gauge } from "@/components/charts/gauge"
import { timeAgo } from "@/lib/reports-store"
import { useLocale } from "@/components/i18n/locale-provider"
import { PercentileLine } from "@/components/repo-anti-rot/percentile-line"
import { PenaltyBreakdownList } from "@/components/repo-anti-rot/penalty-breakdown"
import type { MessageKey } from "@/lib/i18n"

/**
 * The grade, and where its missing points went.
 *
 * Everything here goes through `t()`. It did not before: the whole card was
 * hardcoded English inside an application that ships a Russian locale, so a
 * Russian reader got "Pristine / notes / Scanned 2 hours ago" in the most
 * prominent panel on the page.
 */

const gradeLabelKey: Record<Grade, MessageKey> = {
  A: "gradeLabel.A",
  B: "gradeLabel.B",
  C: "gradeLabel.C",
  D: "gradeLabel.D",
  F: "gradeLabel.F",
}

export function GradeCard({
  grade,
  score,
  scannedAt,
  issues,
  weights,
  scope,
  languages,
}: {
  grade: Grade
  score: number
  /** ISO timestamp of the scan. Formatted here so the relative time is in the
   *  reader's language — passing a pre-formatted string is how "Скан 1 month
   *  ago" happened: the label translated and the value did not. */
  scannedAt: string
  /** Optional: supply to show where the missing points went. */
  issues?: Issue[]
  weights?: SeverityWeights
  /** "1,240 files · 182,431 lines" — what a clean result is clean across. */
  scope?: string | null
  /** Language breakdown, so the percentile can compare like with like. */
  languages?: { language?: string; loc?: number }[]
}) {
  const { t, locale } = useLocale()
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
            {t("grade.score", { score })}
          </span>
        </Gauge>

        <div className="text-center">
          <p className="text-sm font-medium">{t(gradeLabelKey[grade])}</p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {t("gradeCard.scanned", { when: timeAgo(scannedAt, locale) })}
          </p>
          {/* The score's first reading: 94/100 means nothing on its own, and
              "better than 91% of everything scanned" is what a person actually
              wanted to know. Renders nothing when the sample is too small. */}
          <PercentileLine score={score} languages={languages} />
        </div>

        {/* With nothing costing points there is no breakdown to draw, and the
            card used to simply stop — a good result got less on screen than a
            bad one, which is backwards. This says what the clean result covers,
            in the only terms the scan can back. */}
        {breakdown.length === 0 && (
          <div className="w-full border-t border-border pt-4">
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              {scope ? t("gradeCard.cleanScoped", { scope }) : t("gradeCard.clean")}
            </p>
          </div>
        )}

        {/* Where the missing points went. The grade on its own says you have a
            problem; this says which pile of findings is the problem, which is
            the only version you can act on. */}
        {breakdown.length > 0 && (
          <PenaltyBreakdownList
            issues={issues ?? []}
            weights={weights}
            className="border-t border-border pt-4"
          />
        )}
      </CardContent>
    </Card>
  )
}
