import { after, NextResponse } from "next/server"
import { createScanJob, executeScanJob, getScanJob, validJobId } from "@/lib/scan-jobs"
import { mkdtemp, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { isPublicGitUrl } from "@/lib/url-guard"
import { summarizeActivity } from "@/packages/core/src/profile"
import {
  CLI_DIST,
  MAX_CLONE_BYTES,
  SCAN_HEAP_MB,
  SCAN_TIMEOUT_MS,
  SIZE_POLL_MS,
  describeCloneFailure,
  describeFailure,
  run,
  dirSizeExceeds,
  type RunResult,
} from "@/lib/clone-runner"
import {
  QueueFullError,
  QueueTimeoutError,
  checkRateLimit,
  clientIp,
  limitsFromEnv,
  queueDepth,
  withScanSlot,
} from "@/lib/scan-limits"
import { recordRepoUsage, visitorFrom } from "@/lib/usage"
import { recordScanStat } from "@/lib/percentile"
import { isOwner } from "@/lib/owner"
import { ALL_SCAN_IDS, onlyForRequest, sanitizeScannerIds } from "@/lib/scan-selection"
import { readJson } from "@/lib/request-json"

// Cloning + scanning is real work — run on the Node runtime, allow time for it.
export const runtime = "nodejs"
export const maxDuration = 720

/** A progress/result event forwarded to the client over the NDJSON stream. */
type ScanEvent =
  | { type: "queued"; url: string; position: number }
  | { type: "phase"; url: string; phase: "clone" | "scan" | "activity" }
  | { type: "scanner"; url: string; scanner?: string; completed: number; total: number }
  | { type: "repo-done"; url: string; ok: true; report: unknown }
  | { type: "repo-done"; url: string; ok: false; error: string }

/**
 * Commit activity for the About tab. The scan clones `--depth 1`, so after the
 * scan we deepen the same checkout by one year of commit objects only
 * (`--filter=tree:0`: no trees, no blobs — a few KB per hundred commits).
 * Best-effort: any failure just leaves the report without activity.
 */
async function yearActivity(dir: string, signal: AbortSignal) {
  const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10)
  const head = await run("git", ["-C", dir, "log", "-1", "--format=%ct"], { timeoutMs: 10_000, signal })
  const lastCommitAt = (parseInt(head.stdout.trim(), 10) || 0) * 1000
  if (head.code !== 0 || !lastCommitAt) return null

  const deepen = await run(
    "git",
    ["-C", dir, "fetch", "--quiet", "--filter=tree:0", `--shallow-since=${since}`, "origin"],
    { timeoutMs: 30_000, signal },
  )
  // A failed deepen is only trustworthy when HEAD itself is older than the
  // window: then "no commits this year" is the truth, not an artifact.
  if (deepen.code !== 0 && lastCommitAt >= Date.parse(since)) return null

  const log = await run(
    "git",
    ["-C", dir, "log", "--no-merges", `--since=${since}`, "--format=%ae%x02%ct"],
    { timeoutMs: 15_000, signal },
  )
  if (log.code !== 0) return null
  const commits = log.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [author, ct] = line.split("\x02")
      return { author: (author ?? "").toLowerCase(), at: (parseInt(ct ?? "0", 10) || 0) * 1000 }
    })
  return summarizeActivity(commits, lastCommitAt)
}

async function cloneAndScan(
  url: string,
  emit: (ev: ScanEvent) => void,
  only: string[] | null,
  signal: AbortSignal,
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "repo-anti-rot-"))
  const dir = join(workspace, "checkout")
  try {
    emit({ type: "phase", url, phase: "clone" })
    // Watchdog: poll the tree size during the clone and abort if it blows past the
    // cap, so a huge repo can't fill the disk before the timeout would fire.
    const sizeGuard = new AbortController()
    let abortedForSize = false
    const watchdog = setInterval(async () => {
      if (await dirSizeExceeds(dir, MAX_CLONE_BYTES)) {
        abortedForSize = true
        sizeGuard.abort()
      }
    }, SIZE_POLL_MS)
    let clone: RunResult
    try {
      clone = await run(
        "git",
        ["clone", "--depth", "1", "--single-branch", url, dir],
        { timeoutMs: 120_000, signal: AbortSignal.any([sizeGuard.signal, signal]) },
      )
    } finally {
      clearInterval(watchdog)
    }
    if (abortedForSize) {
      emit({
        type: "repo-done",
        url,
        ok: false,
        error: `repository exceeds the ${Math.round(MAX_CLONE_BYTES / (1024 * 1024))} MB clone limit`,
      })
      return
    }
    if (clone.code !== 0) {
      emit({ type: "repo-done", url, ok: false, error: describeCloneFailure(clone) })
      return
    }

    emit({ type: "phase", url, phase: "scan" })
    const reportPath = join(workspace, "report.json")
    const cliArgs = [
      // Cap the child's heap so a huge repository kills the scanner and not
      // the whole service. Without this the container hits its limit and the
      // platform restarts everything, taking every other request with it.
      `--max-old-space-size=${SCAN_HEAP_MB}`,
      CLI_DIST,
      "scan",
      "--path",
      dir,
      "--format",
      "json",
      "--output",
      reportPath,
      "--progress",
    ]
    if (only && only.length > 0) {
      cliArgs.push("--only", only.join(","))
    }
    const scan = await run(
      "node",
      cliArgs,
      {
        timeoutMs: SCAN_TIMEOUT_MS,
        signal,
        onStderrLine: (line) => {
          if (!line.startsWith("@@PROGRESS@@")) return
          try {
            const p = JSON.parse(line.slice("@@PROGRESS@@".length)) as {
              scanner?: string
              completed: number
              total: number
            }
            emit({ type: "scanner", url, scanner: p.scanner, completed: p.completed, total: p.total })
          } catch {
            /* ignore malformed progress line */
          }
        },
      },
    )
    if (scan.code !== 0) {
      emit({ type: "repo-done", url, ok: false, error: describeFailure(scan) })
      return
    }

    const report = JSON.parse(await readFile(reportPath, "utf-8"))
    if (report?.profile && !report.profile.activity) {
      emit({ type: "phase", url, phase: "activity" })
      const activity = await yearActivity(dir, signal).catch(() => null)
      if (activity) report.profile.activity = activity
    }
    emit({ type: "repo-done", url, ok: true, report })
  } catch (err) {
    emit({ type: "repo-done", url, ok: false, error: String(err) })
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function POST(request: Request) {
  const jobId = request.headers.get("x-scan-job")
  if (jobId) {
    if (!validJobId(jobId)) return NextResponse.json({ error: "Invalid scan job ID" }, { status: 400 })
    try {
      const existing = await getScanJob(jobId)
      if (existing) return NextResponse.json({ id: jobId }, { status: 202, headers: { "Cache-Control": "no-store" } })
    } catch {
      return NextResponse.json({ error: "Background scan storage unavailable" }, { status: 503 })
    }
  }
  const limits = limitsFromEnv()

  // Rate limit first: cheapest check, and it must run before we parse or resolve
  // anything an attacker controls.
  // The operator of this instance is exempt from the allowance meant for
  // strangers — but not from the concurrency cap below, which is what protects
  // the machine's memory rather than its fairness.
  const owner = isOwner(request)
  const ip = clientIp(request, limits.trustedProxyHops)
  const rate = owner ? { ok: true as const, retryAfterSec: 0 } : checkRateLimit(ip, limits)
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded — ${limits.maxPerWindow} scans per ${Math.round(limits.windowMs / 60000)} minutes. Try again in ${rate.retryAfterSec}s.`,
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    )
  }

  let body: unknown
  try {
    body = await readJson(request, 32 * 1024)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawUrls = (body as { urls?: unknown; only?: unknown })?.urls
  const urls = Array.isArray(rawUrls)
    ? rawUrls.map((u) => String(u).trim()).filter(Boolean)
    : typeof rawUrls === "string"
      ? [String(rawUrls).trim()].filter(Boolean)
      : []

  if (urls.length === 0) {
    return NextResponse.json({ error: "Provide one or more repository URLs in `urls`." }, { status: 400 })
  }

  const rawOnly = (body as { only?: unknown })?.only
  let only: string[] | null = null
  if (rawOnly !== undefined && rawOnly !== null) {
    if (!Array.isArray(rawOnly)) {
      return NextResponse.json(
        { error: "`only` must be an array of scanner ids." },
        { status: 400 },
      )
    }
    const unknown = rawOnly.map(String).filter((id) => !ALL_SCAN_IDS.includes(id))
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown scanner id(s): ${unknown.join(", ")}` },
        { status: 400 },
      )
    }
    only = onlyForRequest(sanitizeScannerIds(rawOnly))
  }
  if (!owner && urls.length > limits.maxUrlsPerRequest) {
    return NextResponse.json(
      { error: `Too many URLs (max ${limits.maxUrlsPerRequest} per request).` },
      { status: 400 },
    )
  }

  // SSRF guard: reject non-http(s), loopback/private hosts, and DNS names that
  // resolve into private space — checked before any clone runs.
  const checks = await Promise.all(urls.map((u) => isPublicGitUrl(u)))
  const rejected = urls
    .map((u, i) => ({ u, c: checks[i] }))
    .filter((x) => !x.c.ok)
    .map((x) => `${x.u} (${x.c.reason})`)
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: `Refusing to clone unsafe URL(s): ${rejected.join(", ")}` },
      { status: 400 },
    )
  }

  if (jobId) {
    if (new Set(urls).size !== urls.length || urls.length > 20) {
      return NextResponse.json({ error: "Provide at most 20 distinct repository URLs." }, { status: 400 })
    }
    try {
      const { job, created } = await createScanJob(jobId, urls)
      if (created) after(async () => {
        await executeScanJob(job, async (emit, signal) => {
          for (const url of urls) {
            if (signal.aborted) break
            try {
              emit({ type: "queued", url, position: queueDepth() + 1 })
              await withScanSlot(limits, () => cloneAndScan(url, (event) => {
                emit(event)
                if (event.type === "repo-done") {
                  recordRepoUsage(request, "scan", url, { ok: event.ok })
                  if (event.ok) recordScanStat(event.report, visitorFrom(request) === null)
                }
              }, only, signal), signal)
            } catch (err) {
              emit({ type: "repo-done", url, ok: false, error: err instanceof QueueFullError ? "Server is busy. Try again shortly." : "Could not finish scan. Please retry." })
            }
          }
        }).catch(() => { console.error("Background scan could not persist its final status") })
      })
      return NextResponse.json({ id: jobId }, { status: 202, headers: { "Cache-Control": "no-store" } })
    } catch {
      return NextResponse.json({ error: "Background scan storage unavailable or full. Try again later." }, { status: 503 })
    }
  }

  // Stream progress as NDJSON: one JSON object per line. The client reads events
  // ({phase|scanner|repo-done}) to drive a real progress bar, then collects the
  // repo-done payloads as the final results. Scans run sequentially (clone is
  // IO/network heavy) which keeps memory + disk flat and progress readable.
  const encoder = new TextEncoder()
  const cancelled = new AbortController()
  const signal = AbortSignal.any([request.signal, cancelled.signal])
  const stream = new ReadableStream<Uint8Array>({
    cancel() { cancelled.abort() },
    async start(controller) {
      const send = (obj: unknown) => {
        if (signal.aborted) return
        // Usage is recorded from the outcome the server actually produced, not
        // from anything the client says happened. `recordRepoUsage` stores the
        // host and owner/name only — never this URL as given, which can carry
        // credentials — and never any part of the report.
        const ev = obj as { type?: string; url?: string; ok?: boolean; report?: unknown }
        if (ev.type === "repo-done" && ev.url) {
          recordRepoUsage(request, "scan", ev.url, { ok: ev.ok })
          // The result's shape goes to a different table, which has no column
          // for a repository name — so the score recorded here cannot be
          // attached to the repository recorded above. See lib/scan-stats.ts.
          if (ev.ok && ev.report) {
            recordScanStat(ev.report, visitorFrom(request) === null)
          }
        }
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")) } catch { cancelled.abort() }
      }
      // Keep proxies from treating a quiet clone/scanner as an idle connection.
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000)
      const stopHeartbeat = () => clearInterval(heartbeat)
      signal.addEventListener("abort", stopHeartbeat, { once: true })
      try {
      send({ type: "start", total: urls.length })
      for (let i = 0; i < urls.length; i++) {
        if (signal.aborted) break
        const url = urls[i]
        send({ type: "repo-start", url, index: i, total: urls.length })
        // Hold a slot only around the actual work. Failing to get one is a
        // per-repo outcome, not a dead stream: the client still gets a reason.
        try {
          if (queueDepth() > 0) send({ type: "queued", url, position: queueDepth() })
          await withScanSlot(limits, () => cloneAndScan(url, send, only, signal), signal)
        } catch (err) {
          const error =
            err instanceof QueueFullError
              ? "Server is busy — too many scans queued. Try again shortly."
              : err instanceof QueueTimeoutError
                ? "Timed out waiting for a scan slot. Try again shortly."
                : String(err)
          send({ type: "repo-done", url, ok: false, error })
        }
      }
      send({ type: "done" })
      if (!signal.aborted) controller.close()
      } finally {
        stopHeartbeat()
        signal.removeEventListener("abort", stopHeartbeat)
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
