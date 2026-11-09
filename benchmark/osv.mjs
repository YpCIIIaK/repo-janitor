#!/usr/bin/env node
/**
 * Known vulnerabilities in each corpus repo's dependencies, checked online
 * against OSV (https://osv.dev) with the product's own `vulnerable-deps`
 * scanner — the one part of a scan the offline benchmark leaves out.
 *
 * Only manifests and lockfiles are needed, so each repo is fetched as a
 * blob-less clone with a sparse checkout of those files at the pinned SHA:
 * kilobytes instead of the full tree. Output: .results/<repo>.osv.json.
 *
 *   node benchmark/osv.mjs [repo…]     missing or stale repos (resumable)
 *   BENCH_JOBS=6                       parallel repos
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const cli = join(root, "packages", "cli", "dist", "index.js")
const work = join(here, ".osvcache")
const outDir = join(here, ".results")
mkdirSync(work, { recursive: true })
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const only = process.argv.slice(2)

/** Every file name the vulnerable-deps scanner reads, at any depth. */
const SPARSE = [
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock",
  "bun.lock", "bun.lockb", "pyproject.toml", "poetry.lock", "uv.lock", "Pipfile", "Pipfile.lock", "requirements*.txt",
  "requirements/*.txt", "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "Gemfile", "Gemfile.lock", "composer.json", "composer.lock",
].flatMap((p) => [`/${p}`, `**/${p}`]).concat(["!**/node_modules/**", "!**/vendor/**", "!**/third_party/**"])

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts })
    let out = ""
    let err = ""
    p.stdout.on("data", (d) => (out += d))
    p.stderr.on("data", (d) => (err += d))
    p.on("error", (e) => resolve({ status: -1, out, err: e.message }))
    p.on("close", (status) => resolve({ status, out, err }))
  })
}

async function one(repo) {
  const outPath = join(outDir, `${repo.name}.osv.json`)
  if (existsSync(outPath) && JSON.parse(readFileSync(outPath, "utf8")).sha === repo.sha) return "cached"
  const dir = join(work, repo.name)
  rmSync(dir, { recursive: true, force: true })
  try {
    let c
    for (let attempt = 0; attempt < 3; attempt++) {
      c = await sh("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", repo.url, dir])
      if (c.status === 0) break
      rmSync(dir, { recursive: true, force: true })
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
    }
    if (c.status !== 0) throw new Error(`clone failed: ${c.err.trim().split("\n").pop()}`)
    await sh("git", ["-C", dir, "sparse-checkout", "set", "--no-cone", ...SPARSE])
    let co = await sh("git", ["-C", dir, "checkout", "--quiet", repo.sha])
    if (co.status !== 0) {
      await sh("git", ["-C", dir, "fetch", "--quiet", "--filter=blob:none", "origin", repo.sha])
      co = await sh("git", ["-C", dir, "checkout", "--quiet", repo.sha])
      if (co.status !== 0) throw new Error(`checkout failed: ${co.err.trim().split("\n").pop()}`)
    }
    const tmp = `${outPath}.pending`
    const env = { ...process.env }
    delete env.REPO_ANTI_ROT_OFFLINE
    const scan = await sh("node", [cli, "scan", dir, "--only", "vulnerable-deps", "--format", "json", "--output", tmp], { env })
    if (scan.status !== 0 && scan.status !== 2) throw new Error(`scan failed: ${scan.err.trim().split("\n").pop()}`)
    const report = JSON.parse(readFileSync(tmp, "utf8"))
    const failed = report.diagnostics?.failedScanners ?? []
    if (failed.length) throw new Error(`vulnerable-deps failed: ${JSON.stringify(failed)}`)
    const findings = [...(report.issues ?? []), ...(report.lowConfidence ?? [])]
      .filter((i) => i.scanner === "vulnerable-deps")
      .map((i) => ({ id: i.id, severity: i.severity, title: i.title, location: i.location, confidence: i.confidence }))
    writeFileSync(outPath, JSON.stringify({ repo: repo.name, sha: repo.sha, checkedAt: new Date().toISOString(), findings }))
    rmSync(tmp, { force: true })
    return `${findings.length} vulnerable`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const queue = corpus.filter((r) => !only.length || only.includes(r.name))
const jobs = Number(process.env.BENCH_JOBS ?? 6)
let failures = 0
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const r = queue.shift()
      try {
        const res = await one(r)
        if (res !== "cached") console.log(`${r.name.padEnd(36)} ${res}`)
      } catch (e) {
        failures++
        console.error(`${r.name}: ${e.message}`)
      }
    }
  }),
)
console.log(failures ? `${failures} repos failed; rerun to retry them.` : "all repos checked")
