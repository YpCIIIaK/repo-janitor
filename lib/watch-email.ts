/**
 * Plain-text / HTML templates for watch mail.
 *
 * Pure so digests can be unit-tested without a network. Delivery is {@link sendMail}.
 */

import type { StoryIssue } from "@repo-anti-rot/core"

export type DigestCommit = {
  shortSha: string
  subject: string
}

export type DropDigestInput = {
  owner: string
  name: string
  prevGrade: string
  prevScore: number
  nextGrade: string
  nextScore: number
  critical: number
  warning: number
  commits: DigestCommit[]
  scanUrl: string
  manageUrl: string
  unsubUrl: string
  /** One-line regression headline from {@link buildRegressionStory}. */
  storyHeadline?: string
  /** New findings since the last watch baseline. */
  newFindings?: StoryIssue[]
  /** Fallback when we have no baseline ids — current top findings. */
  topFindings?: StoryIssue[]
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function findingsBlock(
  title: string,
  findings: StoryIssue[] | undefined,
): { text: string[]; html: string } {
  if (!findings || findings.length === 0) return { text: [], html: "" }
  const text = [
    title + ":",
    ...findings.map(
      (f) => `  [${f.severity}] ${f.title}${f.location ? ` — ${f.location}` : ""}`,
    ),
    "",
  ]
  const html = `<p><strong>${esc(title)}</strong></p><ul>${findings
    .map(
      (f) =>
        `<li><strong>${esc(f.severity)}</strong> ${esc(f.title)}` +
        (f.location ? ` <code>${esc(f.location)}</code>` : "") +
        `</li>`,
    )
    .join("")}</ul>`
  return { text, html }
}

export function buildDropDigest(input: DropDigestInput): { subject: string; text: string; html: string } {
  const repo = `${input.owner}/${input.name}`
  const subject = `${repo}: ${input.prevGrade} ${input.prevScore} → ${input.nextGrade} ${input.nextScore}`

  const commitLines =
    input.commits.length > 0
      ? input.commits.map((c) => `  ${c.shortSha}  ${c.subject}`).join("\n")
      : "  (no commit list available)"

  const changed =
    input.newFindings && input.newFindings.length > 0
      ? findingsBlock("What changed (new findings)", input.newFindings)
      : findingsBlock("Top findings now", input.topFindings)

  const textParts: string[] = [
    `Repo Anti-Rot — score drop for ${repo}`,
    "",
    `Was:  ${input.prevGrade} ${input.prevScore}/100`,
    `Now:  ${input.nextGrade} ${input.nextScore}/100`,
    `Findings: ${input.critical} critical · ${input.warning} warning`,
    "",
  ]
  if (input.storyHeadline) {
    textParts.push(`What changed: ${input.storyHeadline}`, "")
  }
  textParts.push(...changed.text)
  textParts.push(
    "Recent commits:",
    commitLines,
    "",
    `Rescan: ${input.scanUrl}`,
    `Manage watches: ${input.manageUrl}`,
    `Unsubscribe: ${input.unsubUrl}`,
  )

  const commitHtml =
    input.commits.length > 0
      ? `<ul>${input.commits
          .map(
            (c) =>
              `<li><code>${esc(c.shortSha)}</code> ${esc(c.subject)}</li>`,
          )
          .join("")}</ul>`
      : "<p><em>No commit list available</em></p>"

  const headlineHtml = input.storyHeadline
    ? `<p><strong>What changed:</strong> ${esc(input.storyHeadline)}</p>`
    : ""

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.45;color:#1f2328">
<p><strong>Repo Anti-Rot</strong> — score drop for <code>${esc(repo)}</code></p>
<p>Was: <strong>${esc(input.prevGrade)} ${input.prevScore}</strong>/100<br/>
Now: <strong>${esc(input.nextGrade)} ${input.nextScore}</strong>/100<br/>
Findings: ${input.critical} critical · ${input.warning} warning</p>
${headlineHtml}
${changed.html}
<p>Recent commits:</p>
${commitHtml}
<p><a href="${esc(input.scanUrl)}">Rescan now</a> ·
<a href="${esc(input.manageUrl)}">Manage watches</a> ·
<a href="${esc(input.unsubUrl)}">Unsubscribe</a></p>
</body></html>`

  return { subject, text: textParts.join("\n"), html }
}

export function buildWelcomeWatch(input: {
  owner: string
  name: string
  grade: string
  score: number
  manageUrl: string
  unsubUrl: string
}): { subject: string; text: string; html: string } {
  const repo = `${input.owner}/${input.name}`
  const subject = `Watching ${repo} (${input.grade} ${input.score})`
  const text = [
    `Repo Anti-Rot will email you if ${repo} drops from ${input.grade} ${input.score}/100.`,
    "",
    `Manage: ${input.manageUrl}`,
    `Unsubscribe: ${input.unsubUrl}`,
  ].join("\n")
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.45">
<p>Repo Anti-Rot will email you if <code>${esc(repo)}</code> drops from
<strong>${esc(input.grade)} ${input.score}</strong>/100.</p>
<p><a href="${esc(input.manageUrl)}">Manage watches</a> ·
<a href="${esc(input.unsubUrl)}">Unsubscribe</a></p>
</body></html>`
  return { subject, text, html }
}

export function buildMagicLinkMail(input: {
  manageUrl: string
  count: number
}): { subject: string; text: string; html: string } {
  const subject = "Your Repo Anti-Rot watches"
  const text = [
    `Open your watches (${input.count}):`,
    input.manageUrl,
    "",
    "This link is a capability — anyone with it can manage those subscriptions.",
  ].join("\n")
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.45">
<p><a href="${esc(input.manageUrl)}">Open your watches</a> (${input.count})</p>
<p style="color:#656d76;font-size:13px">This link is a capability — anyone with it can manage those subscriptions.</p>
</body></html>`
  return { subject, text, html }
}
