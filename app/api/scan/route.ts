import { NextResponse } from "next/server"
import { spawn } from "child_process"
import { mkdtemp, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

// Cloning + scanning is real work — run on the Node runtime, allow time for it.
export const runtime = "nodejs"
export const maxDuration = 300

const CLI_DIST = join(process.cwd(), "packages", "cli", "dist", "index.js")

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
  opts: { timeoutMs?: number; onStderrLine?: (line: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true })
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

/** Accept only http(s) git URLs so the API can't be coaxed into local/ssh remotes. */
function isAllowedRepoUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
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
    const clone = await run(
      "git",
      ["clone", "--depth", "1", "--single-branch", url, dir],
      { timeoutMs: 120_000 },
    )
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

  const invalid = urls.filter((u) => !isAllowedRepoUrl(u))
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Only http(s) git URLs are allowed. Rejected: ${invalid.join(", ")}` },
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
