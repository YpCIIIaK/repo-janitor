import { categoryLabels, severityLabels, type Issue, type Severity } from "@/lib/mock-data"

/** Tailwind chip styles per severity, shared by the table and the detail drawer. */
export const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

/** Compact age, e.g. "3d" / "5mo" / "2y". */
export function formatAge(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  return `${days}d`
}

/** Verbose age, e.g. "2 years old". */
export function fullAge(days: number): string {
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? "" : "s"} old`
  }
  if (days >= 30) {
    const m = Math.floor(days / 30)
    return `${m} month${m === 1 ? "" : "s"} old`
  }
  return `${days} day${days === 1 ? "" : "s"} old`
}

/** Render one finding as a Markdown bullet (used by copy actions). */
export function issueAsMarkdown(issue: Issue): string {
  const lines = [
    `- **[${severityLabels[issue.severity]}] ${issue.title}**`,
    `  - Category: ${categoryLabels[issue.category]}`,
    `  - Location: \`${issue.location}\``,
    `  - Age: ${fullAge(issue.ageDays)}`,
    `  - ${issue.detail}`,
  ]
  if (issue.evidence) {
    lines.push(
      issue.evidence.includes("\n")
        ? `\n\`\`\`\n${issue.evidence}\n\`\`\``
        : `  - \`${issue.evidence}\``,
    )
  }
  if (issue.aiNote) lines.push(`  - 🤖 AI: ${issue.aiNote}`)
  return lines.join("\n")
}
