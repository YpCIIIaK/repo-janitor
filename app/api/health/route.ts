import { NextResponse } from "next/server"
import { access, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { CLI_DIST, run } from "@/lib/clone-runner"

/**
 * Deployment health check.
 *
 * Answers the only question that matters when putting this on a new host: will
 * `/api/scan` actually work here? That route shells out to `git` and to the
 * built CLI, and writes a clone to a temp directory — none of which exist on
 * every platform. On a serverless host there is typically no `git` binary at
 * all, and the failure shows up as an opaque 500 on the first user scan.
 *
 * So probe the three preconditions directly and report them. Open this URL right
 * after a deploy and you know in five seconds whether the box can scan, instead
 * of inferring it from someone's pricing page.
 *
 * Doubles as the endpoint a keep-alive pinger hits (see
 * .github/workflows/keepalive.yml): it is cheap, has no side effects that
 * outlive the request, and touching it keeps a free-tier instance awake.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Check {
  ok: boolean
  detail: string
}

/** Is a usable `git` on PATH? Without it, cloning is impossible. */
async function checkGit(): Promise<Check> {
  try {
    const res = await run("git", ["--version"], { timeoutMs: 5_000 })
    if (res.code !== 0) {
      return { ok: false, detail: `git exited ${res.code}: ${res.stderr.trim().slice(0, 200)}` }
    }
    return { ok: true, detail: res.stdout.trim() || "git present" }
  } catch (err) {
    // ENOENT here is the common serverless case: no git binary in the image.
    return { ok: false, detail: `git not runnable: ${String(err).slice(0, 200)}` }
  }
}

/**
 * Is the compiled CLI on disk? The scan route spawns it by path rather than
 * importing it, so a bundler that traces imports will not carry it along.
 */
async function checkCli(): Promise<Check> {
  try {
    await access(CLI_DIST)
    return { ok: true, detail: CLI_DIST }
  } catch {
    return { ok: false, detail: `not found at ${CLI_DIST} — run the CLI build before starting the server` }
  }
}

/** Can we write a clone? Read-only filesystems fail here rather than mid-clone. */
async function checkTmp(): Promise<Check> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), "repo-anti-rot-health-"))
    await writeFile(join(dir, "probe"), "ok", "utf-8")
    return { ok: true, detail: tmpdir() }
  } catch (err) {
    return { ok: false, detail: `temp dir not writable: ${String(err).slice(0, 200)}` }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function GET() {
  const [git, cli, tmp] = await Promise.all([checkGit(), checkCli(), checkTmp()])
  const canScan = git.ok && cli.ok && tmp.ok

  return NextResponse.json(
    {
      ok: true, // the app itself is up; `canScan` is the interesting part
      canScan,
      checks: { git, cli, tmp },
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      hint: canScan
        ? undefined
        : "This host cannot run repository scans. /api/scan needs a real git binary, "
          + "the built CLI on disk and a writable temp dir — i.e. a long-lived container, "
          + "not a serverless function.",
    },
    // Never cached: a cached health check is worse than none, and the keep-alive
    // pinger must actually reach the instance to keep it awake.
    { headers: { "Cache-Control": "no-store" } },
  )
}
