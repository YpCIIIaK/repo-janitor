import { spawn } from "child_process"
import { readdir, stat } from "fs/promises"
import { join } from "path"
import { scanEnvironment } from "@/lib/scan-environment"

/**
 * Shared primitives for the clone+scan API routes (`/api/scan` and
 * `/api/scan/history`): the child-process runner, the clone-size watchdog, and
 * the common constants. Kept in one place so both routes stay in lock-step on
 * limits and process handling.
 */

/** Compiled CLI entrypoint the routes shell out to for an actual scan. */
export const CLI_DIST = join(process.cwd(), "packages", "cli", "dist", "index.js")

// Hard cap on a cloned working tree. `git clone` enforces no size limit itself, so
// even a shallow clone of a hostile/huge repo could fill the disk; the watchdog
// aborts the clone once the tree crosses this line.
export const MAX_CLONE_BYTES = 500 * 1024 * 1024 // 500 MB
export const SIZE_POLL_MS = 2_000

/**
 * Heap ceiling for the scanner child process, in MB.
 *
 * Without one, a large repository grows the child until the CONTAINER runs out
 * of memory, and the platform kills the whole service — every other request in
 * flight dies with it and the instance restarts. With one, the child hits its
 * own limit first and dies alone, leaving the server up and the caller with the
 * explanation `describeFailure` produces.
 *
 * ## Why the default is 192 and not 320
 *
 * `--max-old-space-size` bounds V8's old space, not the process. Measured on a
 * real scan, resident memory runs about a quarter above the ceiling: 96 → 136 MB,
 * 160 → 209 MB, 320 → 405 MB. The old default of 320 therefore let the child
 * reach ~405 MB, and alongside the Next.js server that is more than a 512 MB
 * instance has. Render killed the container — the exact failure this constant
 * exists to prevent, caused by the constant being set as though it bounded the
 * process.
 *
 * 192 puts the child's peak near 240 MB and leaves the server the rest. It costs
 * nothing on ordinary repositories: psf/requests peaks at 93 MB and clap-rs/clap
 * at 143 MB. What it does change is that a repository genuinely needing more —
 * moment/moment wants the full 405 MB, three times its neighbours — is now
 * refused with a message instead of taking the service down with it.
 *
 * Raise it on a bigger box, and raise it in one place: the value is read from
 * the environment so the instance size and this number can be changed together.
 */
export const SCAN_HEAP_MB = Math.max(
  128,
  Number.parseInt(process.env.REPO_ANTI_ROT_SCAN_HEAP_MB ?? "", 10) || 192,
)

/** Progress lines the CLI writes to stderr; never part of an error message. */
const PROGRESS_PREFIX = "@@PROGRESS@@"

/**
 * Turn a failed child's stderr into something worth showing a user.
 *
 * The raw stream is not it. When the scanner is killed mid-run — by the heap
 * limit, by the timeout, by the platform — stderr holds mostly progress lines,
 * so the "error" a user saw was a wall of `@@PROGRESS@@{"completed":3,…}` and no
 * hint of what went wrong. Progress is dropped, the tail is kept (the failure is
 * at the end, not the start), and the whole thing is bounded.
 */
/** Status lines the CLI always writes; they are not the failure. */
const CHATTER = /^(Scanning repository at:|Results written to:|Running \d+ scanner)/i

function stripHostPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s]+/g, "<path>")
    .replace(/\/(?:Users|home|tmp|var|opt)[^\s]*/g, "<path>")
}

export function describeFailure(result: RunResult): string {
  if (result.timedOut) {
    return "scan timed out — this repository took too long on this instance"
  }

  const lines = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(PROGRESS_PREFIX) && !CHATTER.test(l))

  const text = lines.join(" ").toLowerCase()

  // The two ways a big repository ends this, both worth naming plainly: there is
  // nothing the user can fix in their URL, and "exit 134" tells them nothing.
  if (text.includes("heap out of memory") || text.includes("allocation failed")) {
    return `repository is too large to scan on this instance (the scanner ran out of memory at ${SCAN_HEAP_MB} MB)`
  }
  if (result.code === null || result.code === 137 || result.code === 134) {
    return "scan was stopped — it ran out of memory or time. This usually means the repository is very large."
  }

  const detail = stripHostPaths(lines.slice(-4).join(" ").slice(0, 400)).trim()
  // Chatter and host paths are not a reason. Fall back to the exit code.
  if (!detail || detail === "<path>") {
    return `scan failed (exit ${result.code})`
  }
  return `scan failed: ${detail}`
}

/**
 * Clone failures used to quote git's stderr. That stream names the URL as
 * git saw it, local paths, and sometimes the host's git version — none of
 * which the caller needs, and all of which describe the box. The exit is
 * enough: the repository could not be cloned.
 */
export function describeCloneFailure(result: RunResult): string {
  if (result.stderr === "Scan cancelled" || result.code === -1) return "clone was cancelled"
  return "git clone failed"
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** True when we killed the child because `timeoutMs` elapsed. */
  timedOut?: boolean
}

/**
 * Run a command to completion, capturing output and streaming stderr lines to an
 * optional callback as they arrive (used to forward live scan progress). Never
 * rejects on non-zero exit.
 */
export function run(
  cmd: string,
  args: string[],
  opts: {
    timeoutMs?: number
    onStderrLine?: (line: string) => void
    signal?: AbortSignal
    /** Extra non-secret environment for the child. */
    env?: Record<string, string>
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) { resolve({ code: -1, stdout: "", stderr: "Scan cancelled" }); return }
    const child = spawn(cmd, args, {
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...scanEnvironment(), ...opts.env },
    })
    let stdout = ""
    let stderr = ""
    let buf = "" // partial-line buffer for stderr
    let timedOut = false
    const stop = () => {
      if (!child.pid) return
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", env: scanEnvironment() })
        killer.on("error", () => child.kill("SIGKILL"))
      } else {
        try { process.kill(-child.pid, "SIGKILL") } catch { child.kill("SIGKILL") }
      }
    }
    opts.signal?.addEventListener("abort", stop, { once: true })
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          stop()
        }, opts.timeoutMs)
      : null
    const maxOutput = 2 * 1024 * 1024
    child.stdout.on("data", (d) => (stdout = (stdout + d.toString()).slice(-maxOutput)))
    child.stderr.on("data", (d) => {
      const text = d.toString()
      stderr = (stderr + text).slice(-maxOutput)
      if (!opts.onStderrLine) return
      buf += text
      let nl: number
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        opts.onStderrLine(line)
      }
      if (buf.length > maxOutput) buf = buf.slice(-maxOutput)
    })
    child.on("error", (err) => {
      stderr += String(err)
    })
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout)
      opts.signal?.removeEventListener("abort", stop)
      if (buf && opts.onStderrLine) opts.onStderrLine(buf)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * Sum the byte size of a directory tree, short-circuiting as soon as `limit` is
 * exceeded so we never walk an already-too-big tree to completion. Best-effort:
 * unreadable/transient entries (a clone is writing underneath us) are skipped.
 */
export async function dirSizeExceeds(dir: string, limit: number): Promise<boolean> {
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
