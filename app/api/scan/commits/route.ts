import { NextResponse } from "next/server"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { isPublicGitUrl } from "@/lib/url-guard"
import { MAX_CLONE_BYTES, SIZE_POLL_MS, run, dirSizeExceeds } from "@/lib/clone-runner"
import { parseLogWithStats, COMMIT_RS } from "@/lib/commit-sampling"

/**
 * List a repository's commits and what each one changed — without scanning any
 * of them.
 *
 * Choosing which commits to scan used to mean picking a number and hoping. On an
 * old repository with thousands of commits that is a blind guess about where the
 * interesting moments are, and each wrong guess costs a full scan per commit.
 * This endpoint is the cheap half: one blobless clone and one `git log`, no
 * checkouts, no scans.
 *
 * `--name-status` rides along in the same log pass, so the answer includes which
 * files each commit touched — enough to choose on. Not `--numstat`: that reads
 * file contents, which a blobless clone does not have, so git fetches every blob
 * one at a time. Measured on this repository: 67 seconds versus 233 ms, and the
 * clone grew from 190 KB to 1.6 MB. That is what the 60-second `git log` timeout
 * was hitting.
 */
export const runtime = "nodejs"
export const maxDuration = 120

/** Ceiling on returned commits. Matches the history route's own cap. */
const MAX_COMMITS = 250

// Record separator between commits, then US (0x1f) between fields.
const LOG_FORMAT = `${COMMIT_RS}%H%x1f%ct%x1f%P%x1f%D%x1f%s`

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const url = String((body as { url?: unknown })?.url ?? "").trim()
  if (!url) {
    return NextResponse.json({ error: "Provide a repository URL in `url`." }, { status: 400 })
  }

  const check = await isPublicGitUrl(url)
  if (!check.ok) {
    return NextResponse.json(
      { error: `Refusing to clone unsafe URL: ${check.reason}` },
      { status: 400 },
    )
  }

  const dir = await mkdtemp(join(tmpdir(), "repo-anti-rot-log-"))
  try {
    // Blobless clone: we need the commit graph and the diff metadata, never the
    // file contents, so no blobs are fetched at all.
    const sizeGuard = new AbortController()
    let abortedForSize = false
    const watchdog = setInterval(async () => {
      if (await dirSizeExceeds(dir, MAX_CLONE_BYTES)) {
        abortedForSize = true
        sizeGuard.abort()
      }
    }, SIZE_POLL_MS)

    let clone
    try {
      clone = await run("git", ["clone", "--filter=blob:none", "--no-checkout", url, dir], {
        timeoutMs: 120_000,
        signal: sizeGuard.signal,
      })
    } finally {
      clearInterval(watchdog)
    }

    if (abortedForSize) {
      return NextResponse.json(
        { error: `repository exceeds the ${Math.round(MAX_CLONE_BYTES / (1024 * 1024))} MB clone limit` },
        { status: 400 },
      )
    }
    if (clone.code !== 0) {
      return NextResponse.json(
        { error: `git clone failed: ${clone.stderr.trim() || `exit ${clone.code}`}` },
        { status: 400 },
      )
    }

    const log = await run(
      "git",
      [
        "-C",
        dir,
        "log",
        "--first-parent",
        "--name-status",
        `--max-count=${MAX_COMMITS}`,
        `--format=${LOG_FORMAT}`,
      ],
      { timeoutMs: 60_000 },
    )
    if (log.code !== 0) {
      return NextResponse.json(
        { error: `git log failed: ${log.stderr.trim() || `exit ${log.code}`}` },
        { status: 400 },
      )
    }

    const commits = parseLogWithStats(log.stdout)
    return NextResponse.json(
      { commits, capped: commits.length >= MAX_COMMITS },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
