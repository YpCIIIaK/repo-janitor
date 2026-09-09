import { NextResponse } from "next/server"
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DependencyResearchLimitError, researchDependencyGraph, type ScanContext } from "@repo-anti-rot/core"
import { isPublicGitUrl } from "@/lib/url-guard"
import { MAX_CLONE_BYTES, dirSizeExceeds, run, SIZE_POLL_MS } from "@/lib/clone-runner"
import { clientIp, limitsFromEnv, withScanSlot } from "@/lib/scan-limits"
import { allowRate } from "@/lib/watch-rate"
import { readJson } from "@/lib/request-json"
import { isOwner } from "@/lib/owner"

export const runtime = "nodejs"
export const maxDuration = 360

const TARGET_RE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?)?$/i
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"])
const DEP_FILE_RE = /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/
const MAX_WALK_ENTRIES = 50_000
const MAX_DEP_FILE_BYTES = 12 * 1024 * 1024
const SAFE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  GIT_PROTOCOL_FROM_USER: "0",
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "never",
  GIT_CONFIG_KEY_1: "http.followRedirects",
  GIT_CONFIG_VALUE_1: "false",
}

async function researchContext(root: string): Promise<ScanContext> {
  const files: string[] = []
  let visited = 0
  const walk = async (dir: string, prefix = "", depth = 0) => {
    if (depth > 24) throw new Error("Repository directory nesting is too deep")
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++visited > MAX_WALK_ENTRIES) throw new Error("Repository contains too many filesystem entries")
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel, depth + 1)
      else if (entry.isFile() && DEP_FILE_RE.test(rel)) files.push(rel)
    }
  }
  await walk(root)
  return {
    root,
    files,
    repo: { owner: "deep-analysis", name: "repository", defaultBranch: "HEAD" },
    readFile: async (rel) => {
      try {
        const file = join(root, rel)
        if ((await stat(file)).size > MAX_DEP_FILE_BYTES) return null
        return await readFile(file, "utf8")
      } catch { return null }
    },
    git: { blameAgeDays: async () => 0, listBranches: async () => [] },
    log: () => {},
  }
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await readJson(request, 8 * 1024) } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const repoUrl = String((body as { repoUrl?: unknown })?.repoUrl ?? "").trim()
  const target = String((body as { target?: unknown })?.target ?? "").trim()
  const commit = String((body as { commit?: unknown })?.commit ?? "").trim()
  if (!repoUrl || !TARGET_RE.test(target)) {
    return NextResponse.json({ error: "Provide a repository URL and a valid package target." }, { status: 400 })
  }
  if (commit && !/^[0-9a-f]{40}$/i.test(commit)) {
    return NextResponse.json({ error: "Commit must be a full 40-character SHA." }, { status: 400 })
  }
  const safe = await isPublicGitUrl(repoUrl)
  if (!safe.ok) return NextResponse.json({ error: `Unsafe repository URL: ${safe.reason}` }, { status: 400 })

  const limits = limitsFromEnv()
  const ip = clientIp(request, limits.trustedProxyHops)
  if (!isOwner(request) && !allowRate(`dependency-research:${ip}`, 4, 60 * 60_000)) {
    return NextResponse.json({ error: "Deep-analysis limit exceeded. Try again later." },
      { status: 429, headers: { "retry-after": "3600" } })
  }

  const workspace = await mkdtemp(join(tmpdir(), "repo-janitor-research-"))
  const checkout = join(workspace, "checkout")
  const sizeGuard = new AbortController()
  let tooLarge = false
  const watchdog = setInterval(async () => {
    if (await dirSizeExceeds(checkout, MAX_CLONE_BYTES)) { tooLarge = true; sizeGuard.abort() }
  }, SIZE_POLL_MS)
  const signal = AbortSignal.any([request.signal, sizeGuard.signal])

  try {
    return await withScanSlot(limits, async () => {
      const clone = await run("git", ["clone", "--depth", "1", "--single-branch", repoUrl, checkout], {
        timeoutMs: 120_000,
        signal,
        env: SAFE_GIT_ENV,
      })
      if (tooLarge) return NextResponse.json({ error: "Repository exceeds the clone-size limit." }, { status: 413 })
      if (clone.code !== 0) return NextResponse.json({ error: "Could not clone this public repository." }, { status: 502 })

      if (commit) {
        const fetch = await run("git", ["-C", checkout, "fetch", "--depth", "1", "origin", commit], { timeoutMs: 60_000, signal, env: SAFE_GIT_ENV })
        const checkoutCommit = fetch.code === 0
          ? await run("git", ["-C", checkout, "checkout", "--detach", commit], { timeoutMs: 30_000, signal })
          : fetch
        if (checkoutCommit.code !== 0) {
          return NextResponse.json({ error: "The scanned commit is no longer available from this repository." }, { status: 409 })
        }
      }

      const ctx = await researchContext(checkout)
      let result
      try {
        result = await researchDependencyGraph(ctx, new Set(ctx.files), { target, maxPaths: 100, maxNodes: 5_000, maxEdges: 15_000 })
      } catch (error) {
        if (error instanceof DependencyResearchLimitError) {
          return NextResponse.json({ error: "Dependency graph exceeds the deep-analysis safety limit." }, { status: 413 })
        }
        throw error
      }
      if (!result) {
        return NextResponse.json({ error: "Deep analysis currently supports package-lock v2/v3, pnpm-lock v9, and Yarn Classic/Berry." }, { status: 422 })
      }
      if (result.nodes.length > 5_000 || result.edges.length > 15_000) {
        return NextResponse.json({ error: "Dependency graph exceeds the deep-analysis display limit." }, { status: 422 })
      }
      return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } })
    }, signal)
  } catch {
    return NextResponse.json({ error: signal.aborted ? "Research was cancelled." : "The analysis server is busy." }, { status: 503 })
  } finally {
    clearInterval(watchdog)
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}
