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
