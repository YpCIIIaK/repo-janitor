/**
 * Turn a finding into a prefilled GitHub "new issue" URL.
 *
 * We never touch the GitHub API or any token: we just build the public
 * `…/issues/new?title=…&body=…&labels=…` link that opens GitHub's own new-issue
 * form with the fields filled in. The user reviews and clicks "Submit" on
 * GitHub — nothing is posted on their behalf, and no credentials are involved.
 *
 * Returns null when the repo URL isn't a parseable GitHub remote, so the caller
 * can hide the action.
 */

import { categoryLabels, severityLabels, type Issue } from "@/lib/mock-data"
import { githubBase } from "@/lib/github-link"

export interface IssueDraft {
  title: string
  body: string
  labels: string[]
}

// GitHub truncates very long prefill URLs; keep the body comfortably under the
// practical query limit so the link always opens intact.
const MAX_BODY = 6000

/** Compose the title/body/labels for a finding (independent of any URL encoding). */
export function buildIssueDraft(issue: Issue, permalink?: string | null): IssueDraft {
  const sev = severityLabels[issue.severity]
  const cat = categoryLabels[issue.category]

  const lines: string[] = [
    `**Severity:** ${sev} · **Category:** ${cat}`,
    "",
    issue.detail,
    "",
    `**Location:** \`${issue.location}\``,
    `**Age:** ${issue.ageDays} day${issue.ageDays === 1 ? "" : "s"}`,
  ]

  if (issue.evidence) {
    lines.push("", "```", issue.evidence, "```")
  }
  if (permalink) {
    lines.push("", `[View on GitHub](${permalink})`)
  }
  lines.push("", "---", "_Filed from Repo Anti-Rot._")

  let body = lines.join("\n")
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 1)}…`

  // Labels GitHub applies if they already exist on the repo (unknown ones are
  // silently ignored by the new-issue form).
  const labels = ["repo-anti-rot", issue.severity]

  return { title: issue.title, body, labels }
}

/**
 * Full prefilled new-issue URL for a finding, or null when `repoUrl` isn't a
 * GitHub remote. `permalink` (the file URL for the location) is embedded in the
 * body when available.
 */
export function githubNewIssueUrl(
  repoUrl: string | undefined,
  issue: Issue,
  permalink?: string | null,
): string | null {
  const base = githubBase(repoUrl)
  if (!base) return null

  const draft = buildIssueDraft(issue, permalink)
  const params = new URLSearchParams({
    title: draft.title,
    body: draft.body,
    labels: draft.labels.join(","),
  })
  return `${base}/issues/new?${params.toString()}`
}
