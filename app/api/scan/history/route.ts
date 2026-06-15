import { NextResponse } from "next/server"
import { mkdtemp, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { isPublicGitUrl } from "@/lib/url-guard"
import {
  CLI_DIST,
  MAX_CLONE_BYTES,
  SIZE_POLL_MS,
  run,
  dirSizeExceeds,
} from "@/lib/clone-runner"
import { parseLog, selectCommits, type Commit } from "@/lib/commit-sampling"
import { getCachedScan, putCachedScan } from "@/lib/scan-cache"

// Cloning + scanning many commits is heavy — Node runtime, generous budget.
export const runtime = "nodejs"
export const maxDuration = 300

const DEFAULT_SAMPLE = 18
const MAX_SAMPLE = 40
// Hard ceiling when the caller asks to scan *all* commits — keeps a pathological
// history from queuing thousands of per-commit scans.
const ALL_CAP = 250
// Field separator for `git log --format` (US, 0x1f) — safe inside commit subjects.
const US = "%x1f"
const LOG_FORMAT = ["%H", "%ct", "%P", "%D", "%s"].join(US)

/** A scanned commit's report plus how it differs from the next-older scanned node. */
interface NodeReport {
  report: unknown
  diffVsParent: { added: number; fixed: number; hasParent: boolean }
  cached: boolean
}

/** Lightweight commit metadata sent up front so the UI can draw the graph early. */
function skeleton(c: Commit) {
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    date: c.date,
    parents: c.parents,
    subject: c.subject,
    tagged: c.tagged,
  }
}

type HistoryEvent =
  | { type: "start"; url: string }
  | { type: "commits"; commits: ReturnType<typeof skeleton>[] }
  | { type: "node"; sha: string; node: NodeReport }
  | { type: "node-error"; sha: string; error: string }
  | { type: "done" }
  | { type: "error"; error: string }

/** Issue ids from a report payload, for diffing consecutive scans. */
function issueIds(report: unknown): string[] {
  const issues = (report as { issues?: { id: string }[] })?.issues
  return Array.isArray(issues) ? issues.map((i) => i.id) : []
}

/** Scan a single checked-out commit, using the disk cache when possible. */
async function scanCommit(url: string, dir: string, sha: string): Promise<unknown> {
  const cached = await getCachedScan(url, sha)
  if (cached) return cached

  const checkout = await run("git", ["-C", dir, "checkout", "-q", "--detach", sha], {
    timeoutMs: 60_000,
  })
  if (checkout.code !== 0) {
    throw new Error(`checkout failed: ${checkout.stderr.trim() || `exit ${checkout.code}`}`)
  }

  const reportPath = join(dir, "repo-anti-rot-report.json")
  const scan = await run(
    "node",
    [CLI_DIST, "scan", "--path", dir, "--format", "json", "--output", reportPath],
    { timeoutMs: 120_000 },
  )
  if (scan.code !== 0) {
    throw new Error(`scan failed: ${scan.stderr.trim() || `exit ${scan.code}`}`)
  }
  const report = JSON.parse(await readFile(reportPath, "utf-8"))
  await putCachedScan(url, sha, report)
  return report
}

/** Clone history, sample commits, and scan each — emitting progress as it goes. */
async function buildHistory(
  url: string,
  sample: number,
  all: boolean,
  emit: (ev: HistoryEvent) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "repo-anti-rot-hist-"))
  try {
    // Partial clone: full commit graph, blobs fetched lazily on checkout. Keep the
    // size watchdog — even a blobless clone of a hostile repo could balloon on first
    // checkout, but the per-commit work below is what actually pulls blobs.
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
      clone = await run(
        "git",
        ["clone", "--filter=blob:none", "--no-single-branch", url, dir],
        { timeoutMs: 180_000, signal: sizeGuard.signal },
      )
    } finally {
      clearInterval(watchdog)
    }
    if (abortedForSize) {
      emit({ type: "error", error: `repository exceeds the ${Math.round(MAX_CLONE_BYTES / (1024 * 1024))} MB clone limit` })
      return
    }
    if (clone.code !== 0) {
      emit({ type: "error", error: `git clone failed: ${clone.stderr.trim() || `exit ${clone.code}`}` })
      return
    }

    // First-parent history of the default branch (HEAD after clone).
    const log = await run("git", ["-C", dir, "log", "--first-parent", `--format=${LOG_FORMAT}`], {
      timeoutMs: 60_000,
    })
    if (log.code !== 0) {
      emit({ type: "error", error: `git log failed: ${log.stderr.trim() || `exit ${log.code}`}` })
      return
    }

    const commits = parseLog(log.stdout)
    if (commits.length === 0) {
      emit({ type: "error", error: "no commits found in history" })
      return
    }
    const selected = selectCommits(commits, all ? Math.min(commits.length, ALL_CAP) : sample)
    emit({ type: "commits", commits: selected.map(skeleton) })

    // Scan oldest→newest so each node can diff against the previous (older) one.
    const chronological = [...selected].reverse()
    let prevIds: string[] | null = null
    for (const c of chronological) {
      try {
        const report = await scanCommit(url, dir, c.sha)
        const ids = issueIds(report)
        const prev = prevIds
        const added = prev ? ids.filter((id) => !prev.includes(id)).length : 0
        const fixed = prev ? prev.filter((id) => !ids.includes(id)).length : 0
        emit({
          type: "node",
          sha: c.sha,
          node: { report, diffVsParent: { added, fixed, hasParent: prev !== null }, cached: false },
        })
        prevIds = ids
      } catch (err) {
        emit({ type: "node-error", sha: c.sha, error: String(err) })
      }
    }
    emit({ type: "done" })
  } catch (err) {
    emit({ type: "error", error: String(err) })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

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

  const all = Boolean((body as { all?: unknown })?.all)
  const rawSample = Number((body as { sample?: unknown })?.sample)
  const sample = Number.isFinite(rawSample)
    ? Math.max(1, Math.min(MAX_SAMPLE, Math.floor(rawSample)))
    : DEFAULT_SAMPLE

  const check = await isPublicGitUrl(url)
  if (!check.ok) {
    return NextResponse.json({ error: `Refusing to clone unsafe URL: ${check.reason}` }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: HistoryEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"))
      emit({ type: "start", url })
      await buildHistory(url, sample, all, emit)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
