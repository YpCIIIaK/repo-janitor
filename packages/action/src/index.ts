import { promises as fs } from "fs"
import { scanRepo } from "@repo-anti-rot/cli/context"
import { renderSarif, renderTerminal } from "@repo-anti-rot/core"
import type { ScanReport } from "@repo-anti-rot/core"
import {
  getInput,
  ingestEndpoint,
  shouldFail,
  renderPrComment,
  renderStepSummary,
  COMMENT_MARKER,
} from "./lib"

/**
 * Repo Anti-Rot GitHub Action entrypoint.
 *
 * Runs in user CI (on `schedule` / `pull_request`), scans the checked-out repo
 * with the same engine the CLI uses, prints a report, optionally POSTs it to a
 * dashboard's `/api/ingest`, and can fail the job below a grade threshold.
 *
 * Inputs arrive as `INPUT_<NAME>` env vars (the standard GitHub Actions contract),
 * so this needs no `@actions/core` dependency.
 */

/** GitHub workflow command: surfaces as an annotation in the run UI. */
function logError(msg: string): void {
  console.log(`::error::${msg}`)
}

/** Append `key=value` to the file named by an env var (GITHUB_OUTPUT / SUMMARY). */
async function appendToFile(envVar: string, content: string): Promise<void> {
  const file = process.env[envVar]
  if (!file) return
  await fs.appendFile(file, content).catch(() => {})
}

async function setOutputs(report: ScanReport): Promise<void> {
  await appendToFile(
    "GITHUB_OUTPUT",
    `score=${report.score}\ngrade=${report.grade}\nissues=${report.issues.length}\n`,
  )
}

async function writeSummary(report: ScanReport): Promise<void> {
  await appendToFile("GITHUB_STEP_SUMMARY", renderStepSummary(report))
}

/** Write a SARIF 2.1.0 file for upload to GitHub code scanning. */
async function writeSarif(report: ScanReport, file: string): Promise<void> {
  await fs.writeFile(file, renderSarif(report), "utf-8")
  console.log(`Wrote SARIF report to ${file}`)
}

async function upload(report: ScanReport, url: string, token: string): Promise<void> {
  const endpoint = ingestEndpoint(url)
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(report),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`ingest POST failed: ${res.status} ${res.statusText} ${detail}`.trim())
  }
  console.log(`Uploaded report to ${endpoint}`)
}

// ---------------------------------------------------------------------------
// Pull-request sticky comment
// ---------------------------------------------------------------------------

/** The PR number for the current event, or null when not a pull_request run. */
async function getPrNumber(): Promise<number | null> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return null
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) return null
  try {
    const event = JSON.parse(await fs.readFile(path, "utf-8")) as {
      pull_request?: { number?: number }
      number?: number
    }
    return event.pull_request?.number ?? event.number ?? null
  } catch {
    return null
  }
}

/** Post a new sticky comment, or update the existing one if we already left one. */
async function commentOnPr(report: ScanReport, githubToken: string, dashboardUrl: string): Promise<void> {
  const prNumber = await getPrNumber()
  if (prNumber == null) {
    console.log("Not a pull_request event (or no PR number) — skipping PR comment.")
    return
  }
  const repoSlug = process.env.GITHUB_REPOSITORY
  if (!repoSlug) {
    console.log("GITHUB_REPOSITORY not set — skipping PR comment.")
    return
  }

  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "")
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${githubToken}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  }
  const body = renderPrComment(report, dashboardUrl)

  // Find a previous comment of ours (paginate a little; most PRs have few comments).
  let existingId: number | null = null
  for (let page = 1; page <= 5 && existingId == null; page++) {
    const listUrl = `${api}/repos/${repoSlug}/issues/${prNumber}/comments?per_page=100&page=${page}`
    const res = await fetch(listUrl, { headers })
    if (!res.ok) break
    const comments = (await res.json().catch(() => [])) as { id: number; body?: string }[]
    if (!Array.isArray(comments) || comments.length === 0) break
    const mine = comments.find((c) => c.body?.includes(COMMENT_MARKER))
    if (mine) existingId = mine.id
    if (comments.length < 100) break
  }

  const target =
    existingId != null
      ? `${api}/repos/${repoSlug}/issues/comments/${existingId}`
      : `${api}/repos/${repoSlug}/issues/${prNumber}/comments`
  const res = await fetch(target, {
    method: existingId != null ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`PR comment failed: ${res.status} ${res.statusText} ${detail}`.trim())
  }
  console.log(`${existingId != null ? "Updated" : "Posted"} PR health comment on #${prNumber}.`)
}

async function main(): Promise<void> {
  const path = getInput("path", ".")
  const dashboardUrl = getInput("dashboard-url")
  const token = getInput("token")
  const failOn = getInput("fail-on", "never")
  const githubToken = getInput("github-token")
  const prCommentEnabled = getInput("comment-on-pr", "true") !== "false"
  const sarifFile = getInput("sarif-file")

  const root = await fs.realpath(path)
  console.log(`Repo Anti-Rot scanning ${root}`)

  const report = await scanRepo(root)
  console.log(renderTerminal(report))

  await setOutputs(report)
  await writeSummary(report)

  if (sarifFile) {
    await writeSarif(report, sarifFile)
  }

  if (dashboardUrl) {
    await upload(report, dashboardUrl, token)
  } else {
    console.log("No dashboard-url provided — skipping upload.")
  }

  if (prCommentEnabled && githubToken) {
    // A failed comment shouldn't fail the whole job — log and continue.
    await commentOnPr(report, githubToken, dashboardUrl).catch((err) =>
      console.log(`::warning::PR comment skipped: ${String(err)}`),
    )
  }

  if (shouldFail(report, failOn)) {
    logError(`Grade ${report.grade} is at or below the fail-on threshold "${failOn}".`)
    process.exit(1)
  }
}

main().catch((err) => {
  logError(`Repo Anti-Rot action failed: ${String(err)}`)
  process.exit(1)
})
