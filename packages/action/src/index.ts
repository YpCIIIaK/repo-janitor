import { promises as fs } from "fs"
import { scanRepo } from "@repo-anti-rot/cli/context"
import { renderMarkdown, renderTerminal } from "@repo-anti-rot/core"
import type { Grade, ScanReport } from "@repo-anti-rot/core"

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

function getInput(name: string, fallback = ""): string {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`
  return (process.env[key] ?? fallback).trim()
}

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
  await appendToFile("GITHUB_STEP_SUMMARY", `${renderMarkdown(report)}\n`)
}

async function upload(report: ScanReport, url: string, token: string): Promise<void> {
  const endpoint = `${url.replace(/\/+$/, "")}/api/ingest`
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

const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }

/** True when the report's grade is at or below the configured threshold. */
function shouldFail(report: ScanReport, failOn: string): boolean {
  const threshold = failOn.toUpperCase()
  if (!(threshold in GRADE_RANK)) return false // "never" or invalid → never fail
  return GRADE_RANK[report.grade] <= GRADE_RANK[threshold as Grade]
}

async function main(): Promise<void> {
  const path = getInput("path", ".")
  const dashboardUrl = getInput("dashboard-url")
  const token = getInput("token")
  const failOn = getInput("fail-on", "never")

  const root = await fs.realpath(path)
  console.log(`Repo Anti-Rot scanning ${root}`)

  const report = await scanRepo(root)
  console.log(renderTerminal(report))

  await setOutputs(report)
  await writeSummary(report)

  if (dashboardUrl) {
    await upload(report, dashboardUrl, token)
  } else {
    console.log("No dashboard-url provided — skipping upload.")
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
