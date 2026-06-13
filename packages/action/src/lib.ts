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

/** Build the dashboard reports (read) endpoint from a base URL. */
export function reportsEndpoint(url: string): string {
  return `${url.replace(/\/+$/, "")}/api/reports`
}

/** Prior scan to diff a PR's report against — the dashboard's last stored scan for
 * this repo (typically the base branch from a scheduled run). */
export interface Baseline {
  score: number
  issueIds: string[]
}

export interface ScanDelta {
  /** score change vs the baseline (positive = improved) */
  scoreDelta: number
  /** findings present now but not in the baseline */
  added: number
  /** findings in the baseline but gone now (fixed) */
  fixed: number
}

/** Diff a report against a baseline by stable issue id. */
export function scanDelta(report: ScanReport, baseline: Baseline): ScanDelta {
  const prev = new Set(baseline.issueIds)
  const cur = new Set(report.issues.map((i) => i.id))
  let added = 0
  for (const id of cur) if (!prev.has(id)) added++
  let fixed = 0
  for (const id of prev) if (!cur.has(id)) fixed++
  return { scoreDelta: report.score - baseline.score, added, fixed }
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

/** One-line score/finding delta vs the baseline, or "" when there's nothing to show. */
export function renderDeltaLine(delta: ScanDelta): string {
  if (delta.scoreDelta === 0 && delta.added === 0 && delta.fixed === 0) {
    return "No change vs the base scan."
  }
  const parts: string[] = []
  if (delta.scoreDelta > 0) parts.push(`📈 score **+${delta.scoreDelta}**`)
  else if (delta.scoreDelta < 0) parts.push(`📉 score **${delta.scoreDelta}**`)
  else parts.push("score unchanged")
  if (delta.added > 0) parts.push(`🔺 **${delta.added}** new`)
  if (delta.fixed > 0) parts.push(`✅ **${delta.fixed}** fixed`)
  return `${parts.join(" · ")} vs base.`
}

/** Markdown body of the PR comment (carries a hidden marker so we can upsert it).
 * When a `baseline` (the dashboard's last stored scan) is given, a delta line shows
 * how this PR moves the score and finding count. */
export function renderPrComment(report: ScanReport, dashboardUrl: string, baseline?: Baseline | null): string {
  const { repo, grade, score, issues } = report
  const sev = (s: string) => issues.filter((i) => i.severity === s).length
  const order: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  const top = [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 10)

  const lines: string[] = [
    COMMENT_MARKER,
    `### ${GRADE_EMOJI[grade]} Repo Anti-Rot — grade **${grade}** (${score}/100)`,
    "",
  ]

  if (baseline) {
    lines.push(renderDeltaLine(scanDelta(report, baseline)), "")
  }

  lines.push(
    `**${issues.length}** open finding${issues.length === 1 ? "" : "s"}: ` +
      `${sev("critical")} critical · ${sev("warning")} warning · ${sev("info")} info`,
    "",
  )

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
