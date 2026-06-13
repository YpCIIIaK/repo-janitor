import { NextResponse } from "next/server"
import { spawn } from "child_process"
import { mkdtemp, rm, readFile, readdir, stat } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { isPublicGitUrl } from "@/lib/url-guard"

// Cloning + scanning is real work — run on the Node runtime, allow time for it.
export const runtime = "nodejs"
export const maxDuration = 300

const CLI_DIST = join(process.cwd(), "packages", "cli", "dist", "index.js")

// Hard cap on a cloned working tree. `git clone` itself enforces no size limit, so
// even with --depth 1 a hostile or accidentally-huge repo could fill the disk; the
// watchdog below aborts the clone once the tree crosses this line.
const MAX_CLONE_BYTES = 500 * 1024 * 1024 // 500 MB
const SIZE_POLL_MS = 2_000

/**
 * Sum the byte size of a directory tree, short-circuiting as soon as `limit` is
 * exceeded so we never walk an already-too-big tree to completion. Best-effort:
 * unreadable/transient entries (a clone is writing underneath us) are skipped.
 */
async function dirSizeExceeds(dir: string, limit: number): Promise<boolean> {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size
          if (total > limit) return true
        } catch {
          /* file vanished mid-walk — ignore */
        }
      }
    }
  }
  return false
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Run a command to completion, capturing output and streaming stderr lines to an
 * optional callback as they arrive (used to forward live scan progress). Never
 * rejects on non-zero exit.
 */
function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; onStderrLine?: (line: string) => void; signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, signal: opts.signal })
    let stdout = ""
    let stderr = ""
    let buf = "" // partial-line buffer for stderr
    const timeout = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : null
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => {
      const text = d.toString()
      stderr += text
      if (!opts.onStderrLine) return
      buf += text
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        opts.onStderrLine(line)
      }
    })
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout)
      resolve({ code: -1, stdout, stderr: stderr + String(err) })
    })
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout)
      if (buf && opts.onStderrLine) opts.onStderrLine(buf)
      resolve({ code, stdout, stderr })
    })
  })
}

/** A progress/result event forwarded to the client over the NDJSON stream. */
type ScanEvent =
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
  if (urls.length > 20) {
    return NextResponse.json({ error: "Too many URLs (max 20 per request)." }, { status: 400 })
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
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      send({ type: "start", total: urls.length })
      for (let i = 0; i < urls.length; i++) {
        send({ type: "repo-start", url: urls[i], index: i, total: urls.length })
        await cloneAndScan(urls[i], send)
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
