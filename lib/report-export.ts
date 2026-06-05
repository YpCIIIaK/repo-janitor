import { categoryLabels, severityLabels, type Grade, type Issue } from "@/lib/mock-data"
import type { ScanReport } from "@/lib/reports-store"
import { issueAsMarkdown } from "@/lib/issue-format"

/**
 * Client-side report export (JSON / Markdown / CSV).
 *
 * Exports the canonical stored scan report — every finding from the scan, with
 * its original score/grade/timestamp — so the artifact is a faithful record for
 * tickets, audits and sharing. (Snooze is a local view preference and is not
 * applied here.) All rendering is pure and runs in the browser; nothing leaves
 * the machine.
 */

export type ExportFormat = "json" | "md" | "csv"

const SEVERITY_RANK: Record<Issue["severity"], number> = { critical: 3, warning: 2, info: 1 }

/** Most-severe first, then oldest first — same order the reporters use. */
function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    return sev !== 0 ? sev : b.ageDays - a.ageDays
  })
}

function countBySeverity(issues: Issue[]) {
  const c = { critical: 0, warning: 0, info: 0 }
  for (const i of issues) c[i.severity]++
  return c
}

const GRADE_EMOJI: Record<Grade, string> = { A: "🟢", B: "🟢", C: "🟡", D: "🟠", F: "🔴" }

/** Pretty-printed raw report JSON (full schema fidelity). */
export function reportToJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2)
}

/** Human-readable Markdown summary + grouped findings, for PRs/issues/docs. */
export function reportToMarkdown(report: ScanReport): string {
  const { repo, grade, score, issues } = report
  const counts = countBySeverity(issues)
  const lines: string[] = [
    `# ${GRADE_EMOJI[grade]} Repo Anti-Rot — ${repo.owner}/${repo.name}`,
    "",
    `**Grade:** ${grade} (${score}/100)`,
    "",
    `**Issues:** ${issues.length} — ${counts.critical} critical · ${counts.warning} warning · ${counts.info} info`,
    "",
  ]
  if (report.metrics?.linesOfCode) {
    lines.push(`**Lines of code:** ${report.metrics.linesOfCode.toLocaleString()}`, "")
  }

  if (issues.length === 0) {
    lines.push("✅ No issues found — clean repo.")
  } else {
    // Group by category so the document reads like an audit, not a flat dump.
    const byCategory = new Map<Issue["category"], Issue[]>()
    for (const i of sortIssues(issues)) {
      const bucket = byCategory.get(i.category)
      if (bucket) bucket.push(i)
      else byCategory.set(i.category, [i])
    }
    for (const [category, group] of byCategory) {
      lines.push(`## ${categoryLabels[category]} (${group.length})`, "")
      for (const i of group) lines.push(issueAsMarkdown(i))
      lines.push("")
    }
  }

  lines.push(`<sub>Generated ${report.generatedAt} · schema v${report.schemaVersion}</sub>`)
  return lines.join("\n")
}

/** Escape a value for safe inclusion in a CSV cell (RFC 4180). */
function csvCell(value: string | number): string {
  const s = String(value ?? "")
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Spreadsheet-friendly CSV — one row per finding. */
export function reportToCsv(report: ScanReport): string {
  const header = ["severity", "category", "title", "location", "ageDays", "detail", "evidence", "aiNote"]
  const rows = sortIssues(report.issues).map((i) =>
    [
      severityLabels[i.severity],
      categoryLabels[i.category],
      i.title,
      i.location,
      i.ageDays,
      i.detail,
      i.evidence ?? "",
      i.aiNote ?? "",
    ]
      .map(csvCell)
      .join(","),
  )
  // Prepend a UTF-8 BOM (U+FEFF) so Excel detects encoding and renders emoji/accents.
  const BOM = String.fromCharCode(0xfeff)
  return BOM + [header.join(","), ...rows].join("\r\n")
}

const FORMAT_META: Record<ExportFormat, { ext: string; mime: string; render: (r: ScanReport) => string }> = {
  json: { ext: "json", mime: "application/json", render: reportToJson },
  md: { ext: "md", mime: "text/markdown", render: reportToMarkdown },
  csv: { ext: "csv", mime: "text/csv", render: reportToCsv },
}

/** Trigger a browser download of the report in the given format. */
export function downloadReport(report: ScanReport, format: ExportFormat): void {
  if (typeof window === "undefined") return
  const { ext, mime, render } = FORMAT_META[format]
  const safe = `${report.repo.owner}-${report.repo.name}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
  const blob = new Blob([render(report)], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${safe}-anti-rot.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
