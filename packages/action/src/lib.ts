import { renderMarkdown } from "@repo-anti-rot/core"
import type { Grade, ScanReport } from "@repo-anti-rot/core"

/**
 * Pure helpers for the GitHub Action, split out from the entrypoint so they can be
 * unit-tested without running `main()` (index.ts auto-executes on import).
 */

/** Read an action input from its `INPUT_<NAME>` env var (GitHub Actions contract). */
export function getInput(name: string, fallback = ""): string {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`
  return (process.env[key] ?? fallback).trim()
}

/** Build the dashboard ingest endpoint from a base URL (trailing slashes trimmed). */
export function ingestEndpoint(url: string): string {
  return `${url.replace(/\/+$/, "")}/api/ingest`
}

export const COMMENT_MARKER = "<!-- repo-anti-rot-report -->"

export const GRADE_EMOJI: Record<Grade, string> = {
  A: "🟢",
  B: "🟢",
  C: "🟡",
  D: "🟠",
  F: "🔴",
}

const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }

/**
 * True when the report's grade is at or below the configured threshold. A missing
 * or invalid threshold (e.g. "never") never fails the job.
 */
export function shouldFail(report: ScanReport, failOn: string): boolean {
  const threshold = failOn.toUpperCase()
  if (!(threshold in GRADE_RANK)) return false
  return GRADE_RANK[report.grade] <= GRADE_RANK[threshold as Grade]
}

/** Markdown body of the PR comment (carries a hidden marker so we can upsert it). */
export function renderPrComment(report: ScanReport, dashboardUrl: string): string {
  const { repo, grade, score, issues } = report
  const sev = (s: string) => issues.filter((i) => i.severity === s).length
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  const top = [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 10)

  const lines: string[] = [
    COMMENT_MARKER,
    `### ${GRADE_EMOJI[grade]} Repo Anti-Rot — grade **${grade}** (${score}/100)`,
    "",
    `**${issues.length}** open finding${issues.length === 1 ? "" : "s"}: ` +
      `${sev("critical")} critical · ${sev("warning")} warning · ${sev("info")} info`,
    "",
  ]

  if (issues.length === 0) {
    lines.push("No rot detected — clean scan. ✅")
  } else {
    lines.push("| Severity | Finding | Location |", "| --- | --- | --- |")
    for (const i of top) {
      const loc = i.location.replace(/\|/g, "\\|")
      const title = i.title.replace(/\|/g, "\\|")
      lines.push(`| ${i.severity} | ${title} | \`${loc}\` |`)
    }
    if (issues.length > top.length) {
      lines.push("", `…and ${issues.length - top.length} more.`)
    }
  }

  if (dashboardUrl) {
    const base = dashboardUrl.replace(/\/+$/, "")
    lines.push(
      "",
      `[Full report](${base}) · ![grade](${base}/api/badge/${repo.owner}/${repo.name})`,
    )
  }

  lines.push("", `<sub>Updated by Repo Anti-Rot at ${new Date().toISOString()}</sub>`)
  return lines.join("\n")
}

/** Render the GitHub step-summary markdown for a report. */
export function renderStepSummary(report: ScanReport): string {
  return `${renderMarkdown(report)}\n`
}
