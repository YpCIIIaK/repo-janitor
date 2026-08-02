import "server-only"
import { mkdtemp, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import {
  CLI_DIST,
  MAX_CLONE_BYTES,
  SCAN_HEAP_MB,
  SIZE_POLL_MS,
  describeFailure,
  run,
  dirSizeExceeds,
} from "@/lib/clone-runner"
import { parseLog, type Commit } from "@/lib/commit-sampling"
import { isGrade } from "@/lib/watch-drop"
import type { Grade } from "@/lib/mock-data"
import type { DigestCommit } from "@/lib/watch-email"

/**
 * Headless clone+scan for the watch cron — no NDJSON stream, returns a summary.
 */

export type WatchScanResult =
  | {
      ok: true
      grade: Grade
      score: number
      sha: string | null
      critical: number
      warning: number
      commits: DigestCommit[]
    }
  | { ok: false; error: string }

const US = "%x1f"
const LOG_FORMAT = ["%H", "%ct", "%P", "%D", "%s"].join(US)

function countsFromReport(report: {
  issues?: { severity?: string }[]
}): { critical: number; warning: number } {
  let critical = 0
  let warning = 0
  for (const i of report.issues ?? []) {
    if (i.severity === "critical") critical++
    else if (i.severity === "warning") warning++
  }
  return { critical, warning }
}

function toDigestCommits(commits: Commit[], limit = 5): DigestCommit[] {
  return commits.slice(0, limit).map((c) => ({
    shortSha: c.sha.slice(0, 7),
    subject: c.subject.slice(0, 120) || "(no subject)",
  }))
}

/**
 * Clone `url`, scan HEAD, optionally list commits since `sinceSha`.
 */
export async function scanWatchedRepo(
  url: string,
  sinceSha?: string | null,
): Promise<WatchScanResult> {
  const dir = await mkdtemp(join(tmpdir(), "rar-watch-"))
  try {
    const sizeGuard = new AbortController()
    let abortedForSize = false
    const watchdog = setInterval(async () => {
      if (await dirSizeExceeds(dir, MAX_CLONE_BYTES)) {
        abortedForSize = true
        sizeGuard.abort()
      }
    }, SIZE_POLL_MS)

    // Need history for commit list when we have a previous SHA — deepen a bit.
    const depth = sinceSha ? "50" : "1"
    let clone
    try {
      clone = await run(
        "git",
        ["clone", `--depth=${depth}`, "--single-branch", url, dir],
        { timeoutMs: 120_000, signal: sizeGuard.signal },
      )
    } finally {
      clearInterval(watchdog)
    }

    if (abortedForSize) {
      return {
        ok: false,
        error: `repository exceeds the ${Math.round(MAX_CLONE_BYTES / (1024 * 1024))} MB clone limit`,
      }
    }
    if (clone.code !== 0) {
      return { ok: false, error: `git clone failed: ${clone.stderr.trim() || `exit ${clone.code}`}` }
    }

    const head = await run("git", ["-C", dir, "rev-parse", "HEAD"], { timeoutMs: 15_000 })
    const sha = head.code === 0 ? head.stdout.trim() : null

    let commits: DigestCommit[] = []
    if (sinceSha && sha && /^[0-9a-f]{7,40}$/i.test(sinceSha)) {
      // Try range; if the shallow clone missed the old tip, fall back to recent log.
      const range = await run(
        "git",
        ["-C", dir, "log", "--first-parent", `--format=${LOG_FORMAT}`, `${sinceSha}..HEAD`],
        { timeoutMs: 30_000 },
      )
      if (range.code === 0 && range.stdout.trim()) {
        commits = toDigestCommits(parseLog(range.stdout))
      }
    }
    if (commits.length === 0) {
      const recent = await run(
        "git",
        ["-C", dir, "log", "--first-parent", "-n", "5", `--format=${LOG_FORMAT}`],
        { timeoutMs: 30_000 },
      )
      if (recent.code === 0) commits = toDigestCommits(parseLog(recent.stdout))
    }

    const reportPath = join(dir, "repo-anti-rot-report.json")
    const scan = await run(
      "node",
      [
        `--max-old-space-size=${SCAN_HEAP_MB}`,
        CLI_DIST,
        "scan",
        "--path",
        dir,
        "--format",
        "json",
        "--output",
        reportPath,
      ],
      { timeoutMs: 120_000 },
    )
    if (scan.code !== 0) {
      return { ok: false, error: describeFailure(scan) }
    }

    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      grade?: string
      score?: number
      issues?: { severity?: string }[]
      commit?: string
    }
    if (!report.grade || !isGrade(report.grade) || typeof report.score !== "number") {
      return { ok: false, error: "scan produced an unusable report" }
    }
    const { critical, warning } = countsFromReport(report)
    return {
      ok: true,
      grade: report.grade,
      score: Math.round(report.score),
      sha: typeof report.commit === "string" ? report.commit : sha,
      critical,
      warning,
      commits,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
