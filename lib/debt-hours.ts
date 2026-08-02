import type { Issue, Severity } from "@/lib/mock-data"

/**
 * Rough “hours of work” heuristic for overview delight.
 *
 * Not a timesheet — a single sticky number people want to drive down. Tuned so
 * a typical mid-size scan lands in a memorable band (a few hours to a couple of
 * days), not “0.4” or “940”.
 */

/** Hours attributed to one finding of each severity. */
export const HOURS_PER_SEVERITY: Record<Severity, number> = {
  critical: 4,
  warning: 1.5,
  info: 0.25,
}

export function estimateDebtHours(issues: Pick<Issue, "severity">[]): number {
  let h = 0
  for (const i of issues) h += HOURS_PER_SEVERITY[i.severity] ?? 0
  return h
}

/** Display: "0h", "45m", "3h", "1.5d". */
export function formatDebtHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h"
  if (hours < 1) {
    const m = Math.max(15, Math.round(hours * 60))
    return `${m}m`
  }
  if (hours < 16) {
    const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)
    return `${rounded}h`
  }
  const days = Math.round((hours / 8) * 10) / 10
  return `${days}d`
}
