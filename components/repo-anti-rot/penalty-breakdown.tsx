"use client"

import type { Issue } from "@/lib/mock-data"
import { penaltyBreakdown, type SeverityWeights } from "@/lib/score"
import { severityStyle } from "@/lib/issue-format"
import { cn } from "@/lib/utils"
import { useLocale } from "@/components/i18n/locale-provider"
import type { MessageKey } from "@/lib/i18n"

const severityKey: Record<string, MessageKey> = {
  critical: "issues.critical",
  warning: "issues.warning",
  info: "gradeCard.notes",
}

/**
 * Where the missing score points went — shared by GradeCard, landing example,
 * and the compact post-scan ResultCard.
 */
export function PenaltyBreakdownList({
  issues,
  weights,
  className,
}: {
  /** Full Issue or scan-runner's slim row — only `severity` is read. */
  issues: Pick<Issue, "severity">[]
  weights?: SeverityWeights
  className?: string
}) {
  const { t } = useLocale()
  const breakdown = penaltyBreakdown(issues as Issue[], weights).filter((p) => p.penalty > 0)
  if (breakdown.length === 0) return null

  return (
    <div className={cn("w-full space-y-1.5", className)}>
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
          <span className="text-muted-foreground">{t(severityKey[p.severity])}</span>
          <span className="ml-auto font-mono tabular-nums text-muted-foreground">
            {t("gradeCard.points", { points: p.penalty.toFixed(1) })}
          </span>
        </div>
      ))}
      {breakdown.some((p) => p.discounted) && (
        <p className="pt-1 text-[11px] leading-snug text-muted-foreground/70">
          {t("gradeCard.taperNote")}
        </p>
      )}
    </div>
  )
}
