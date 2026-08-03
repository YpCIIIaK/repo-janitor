import { spawn } from "child_process"
import { readdir, stat } from "fs/promises"
import { join } from "path"

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
export function describeFailure(result: RunResult): string {
  const lines = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(PROGRESS_PREFIX))

  const text = lines.join(" ").toLowerCase()

  // The two ways a big repository ends this, both worth naming plainly: there is
  // nothing the user can fix in their URL, and "exit 134" tells them nothing.
  if (text.includes("heap out of memory") || text.includes("allocation failed")) {
    return `repository is too large to scan on this instance (the scanner ran out of memory at ${SCAN_HEAP_MB} MB)`
  }
  if (result.code === null || result.code === 137 || result.code === 134) {
    return "scan was stopped — it ran out of memory or time. This usually means the repository is very large."
  }

  const detail = lines.slice(-4).join(" ").slice(0, 400)
  return detail ? `scan failed: ${detail}` : `scan failed (exit ${result.code})`
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
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
    /** Extra environment for the child, merged over the parent's. */
    env?: Record<string, string>
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      signal: opts.signal,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    })
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
