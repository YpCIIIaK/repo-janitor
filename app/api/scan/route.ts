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
import { recordRepoUsage } from "@/lib/usage"
import { isOwner } from "@/lib/owner"

// Cloning + scanning is real work — run on the Node runtime, allow time for it.
export const runtime = "nodejs"
export const maxDuration = 300

/** A progress/result event forwarded to the client over the NDJSON stream. */
type ScanEvent =
  | { type: "queued"; url: string; position: number }
  | { type: "phase"; url: string; phase: "clone" | "scan" }
  | { type: "scanner"; url: string; scanner?: string; completed: number; total: number }
  | { type: "repo-done"; url: string; ok: true; report: unknown }
  | { type: "repo-done"; url: string; ok: false; error: string }

async function cloneAndScan(url: string, emit: (ev: ScanEvent) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "repo-anti-rot-"))
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
        { timeoutMs: 120_000, signal: sizeGuard.signal },
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
      emit({ type: "repo-done", url, ok: false, error: `git clone failed: ${clone.stderr.trim() || `exit ${clone.code}`}` })
      return
    }

    emit({ type: "phase", url, phase: "scan" })
    const reportPath = join(dir, "repo-anti-rot-report.json")
    const scan = await run(
      "node",
      [CLI_DIST, "scan", "--path", dir, "--format", "json", "--output", reportPath, "--progress"],
      {
        timeoutMs: 120_000,
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
      emit({ type: "repo-done", url, ok: false, error: `scan failed: ${scan.stderr.trim() || `exit ${scan.code}`}` })
      return
    }

    const report = JSON.parse(await readFile(reportPath, "utf-8"))
    emit({ type: "repo-done", url, ok: true, report })
  } catch (err) {
    emit({ type: "repo-done", url, ok: false, error: String(err) })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function POST(request: Request) {
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
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawUrls = (body as { urls?: unknown })?.urls
  const urls = Array.isArray(rawUrls)
    ? rawUrls.map((u) => String(u).trim()).filter(Boolean)
    : typeof rawUrls === "string"
      ? [String(rawUrls).trim()].filter(Boolean)
      : []

  if (urls.length === 0) {
    return NextResponse.json({ error: "Provide one or more repository URLs in `urls`." }, { status: 400 })
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

  // Stream progress as NDJSON: one JSON object per line. The client reads events
  // ({phase|scanner|repo-done}) to drive a real progress bar, then collects the
  // repo-done payloads as the final results. Scans run sequentially (clone is
  // IO/network heavy) which keeps memory + disk flat and progress readable.
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        // Usage is recorded from the outcome the server actually produced, not
        // from anything the client says happened. `recordRepoUsage` stores the
        // host and owner/name only — never this URL as given, which can carry
        // credentials — and never any part of the report.
        const ev = obj as { type?: string; url?: string; ok?: boolean }
        if (ev.type === "repo-done" && ev.url) {
          recordRepoUsage(request, "scan", ev.url, { ok: ev.ok })
        }
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }
      send({ type: "start", total: urls.length })
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        send({ type: "repo-start", url, index: i, total: urls.length })
        // Hold a slot only around the actual work. Failing to get one is a
        // per-repo outcome, not a dead stream: the client still gets a reason.
        try {
          if (queueDepth() > 0) send({ type: "queued", url, position: queueDepth() })
          await withScanSlot(limits, () => cloneAndScan(url, send), request.signal)
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
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
