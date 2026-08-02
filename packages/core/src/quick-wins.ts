import type { Issue, Severity } from "./schema"
import { sortIssues } from "./reporters/shared"

/**
 * “What to fix in an hour” — severity-first, then oldest, capped.
 *
 * Pure so the CLI `--fix` flag and any UI can share the same ranking.
 */

const HOURS: Record<Severity, number> = {
  critical: 4,
  warning: 1.5,
  info: 0.25,
}

export type QuickWin = Issue & { estHours: number }

export function quickWins(issues: Issue[], limit = 8): QuickWin[] {
  return sortIssues(issues)
    .slice(0, Math.max(0, limit))
    .map((i) => ({ ...i, estHours: HOURS[i.severity] ?? 0.25 }))
}

export function formatQuickWinsTerminal(wins: QuickWin[]): string {
  if (wins.length === 0) return "No findings — nothing to fix."
  const lines = [
    "Quick wins (fix these first — roughly an hour of focused work for the top few):",
    "",
  ]
  for (let n = 0; n < wins.length; n++) {
    const w = wins[n]
    const hrs = w.estHours < 1 ? `~${Math.round(w.estHours * 60)}m` : `~${w.estHours}h`
    lines.push(`${n + 1}. [${w.severity}] ${w.title}  (${hrs})`)
    lines.push(`   ${w.location}`)
  }
  return lines.join("\n")
}
