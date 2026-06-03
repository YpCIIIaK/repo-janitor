import type { Grade, Issue, ScanReport, Severity } from "../schema"
import { countBySeverity, sortIssues } from "./shared"

/**
 * Markdown report for PR comments / GitHub issues. Self-contained (no HTML) so it
 * renders anywhere GitHub-flavoured Markdown is supported.
 */
const GRADE_EMOJI: Record<Grade, string> = { A: "🟢", B: "🟢", C: "🟡", D: "🟠", F: "🔴" }
const SEVERITY_EMOJI: Record<Severity, string> = { critical: "🔴", warning: "🟡", info: "🔵" }

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function issueRow(i: Issue): string {
  // Evidence is already redacted for secrets; show it as inline code under the title.
  const title = i.evidence
    ? `${escapeCell(i.title)}<br>\`${escapeCell(i.evidence)}\``
    : escapeCell(i.title)
  return `| ${SEVERITY_EMOJI[i.severity]} ${i.severity} | ${title} | \`${escapeCell(i.location)}\` | ${i.ageDays}d |`
}

export function renderMarkdown(report: ScanReport): string {
  const counts = countBySeverity(report.issues)
  const lines: string[] = []

  lines.push(`## ${GRADE_EMOJI[report.grade]} Repo Anti-Rot — ${report.repo.owner}/${report.repo.name}`)
  lines.push("")
  lines.push(`**Health Score:** ${report.score}/100 &nbsp;·&nbsp; **Grade:** ${report.grade}`)
  lines.push("")
  lines.push(
    `**Issues:** ${report.issues.length} ` +
      `(${counts.critical} critical, ${counts.warning} warning, ${counts.info} info)`,
  )
  lines.push("")

  if (report.issues.length === 0) {
    lines.push("✅ No issues found — clean repo.")
  } else {
    lines.push("| Severity | Issue | Location | Age |")
    lines.push("| --- | --- | --- | --- |")
    for (const i of sortIssues(report.issues)) lines.push(issueRow(i))
  }

  lines.push("")
  lines.push(`<sub>Generated ${report.generatedAt} · schema v${report.schemaVersion}</sub>`)
  return lines.join("\n")
}
