#!/usr/bin/env node
/**
 * Scan every corpus repo at its pinned commit, offline, and write a slim
 * result per repo to benchmark/.results/ (git-ignored).
 *
 *   pnpm bench:run [name ...]
 *
 * Clones are cached in benchmark/.cache/ (full history, so the
 * history-based scanners run as they do in the CLI).
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const cli = join(root, "packages", "cli", "dist", "index.js")
const cacheDir = join(here, ".cache")
const outDir = join(here, ".results")
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const only = process.argv.slice(2)


if (!existsSync(cli)) {
  console.error("Build the CLI first: pnpm run build:cli")
  process.exit(1)
}
mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

/** Async spawn, so several repos clone and scan at once. */
function sh2(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    p.stdout.on("data", (d) => (stdout += d))
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)))
    p.on("error", (error) => resolve({ status: -1, stdout, stderr: error.message }))
    p.on("close", (status) => resolve({ status, stdout, stderr }))
  })
}

async function runOne(repo) {
  const dir = join(cacheDir, repo.name)
  if (!existsSync(dir)) {
    // Network hiccups (a proxy restart, a dropped TLS stream) are common over a
    // multi-hour run: retry with backoff before giving up on the repo.
    let c
    for (let attempt = 0; attempt < 4; attempt++) {
      rmSync(dir, { recursive: true, force: true })
      c = await sh2("git", ["-c", "core.longpaths=true", "clone", "--quiet", "--no-checkout", repo.url, dir])
      if (c.status === 0) break
      await new Promise((r) => setTimeout(r, 15000 * 2 ** attempt))
    }
    if (c.status !== 0) throw new Error(`clone failed: ${repo.name}\n${c.stderr}`)
  }
  let co = await sh2("git", ["-C", dir, "-c", "core.longpaths=true", "checkout", "--quiet", "--force", repo.sha])
  if (co.status !== 0) {
    await sh2("git", ["-C", dir, "fetch", "--quiet", "origin", repo.sha])
    co = await sh2("git", ["-C", dir, "-c", "core.longpaths=true", "checkout", "--quiet", "--force", repo.sha])
    if (co.status !== 0) throw new Error(`checkout failed: ${repo.name}\n${co.stderr}`)
  }
  const reportPath = join(outDir, `${repo.name}.report.json`)
  const pendingReport = `${reportPath}.pending`
  const started = Date.now()
  const scan = await sh2("node", [cli, "scan", dir, "--format", "json", "--output", pendingReport], {
    env: { ...process.env, REPO_ANTI_ROT_OFFLINE: "1" },
  })
  if (scan.status !== 0 && scan.status !== 2) throw new Error(`scan failed: ${repo.name}\n${scan.stderr}`)
  const report = JSON.parse(readFileSync(pendingReport, "utf8"))
  if (report.diagnostics?.failedScanners?.length) {
    throw new Error(`incomplete scan: ${repo.name}: ${JSON.stringify(report.diagnostics.failedScanners)}`)
  }
  // The benchmark judges every rule, including the ones shipped as low confidence.
  const findings = [...report.issues, ...(report.lowConfidence ?? [])].map((i) => ({
    id: i.id,
    scanner: i.scanner,
    rule: i.rule,
    confidence: i.confidence,
    severity: i.severity,
    title: i.title,
    location: i.location,
    detail: i.detail,
    evidence: i.evidence,
  }))
  const resultPath = join(outDir, `${repo.name}.json`)
  writeFileSync(`${resultPath}.pending`, JSON.stringify({ repo: repo.name, sha: repo.sha, findings }, null, 1))
  renameSync(pendingReport, reportPath)
  renameSync(`${resultPath}.pending`, resultPath)
  // The checkout is only needed while scanning: the next run restores it from
  // .git with `checkout --force`. Keeping 500 working trees fills the disk.
  // BENCH_DROP_CLONES=1 removes the whole clone (the next run clones again by SHA),
  // so a corpus far larger than the disk can still be scanned one repo at a time.
  if (process.env.BENCH_DROP_CLONES === "1") {
    await sh2("node", [join(here, "history.mjs"), repo.name])
    rmSync(dir, { recursive: true, force: true })
  }
  else if (process.env.BENCH_KEEP_TREES !== "1") {
    for (const entry of readdirSync(dir)) if (entry !== ".git") rmSync(join(dir, entry), { recursive: true, force: true })
  }
  console.log(`${repo.name.padEnd(28)} ${String(findings.length).padStart(5)} findings  ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

const queue = corpus.filter((r) => !only.length || only.includes(r.name))
const workers = Number(process.env.BENCH_JOBS ?? 6)
if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw new Error("BENCH_JOBS must be an integer from 1 to 32")
let failures = 0
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (queue.length) {
      try { await runOne(queue.shift()) }
      catch (error) { failures++; console.error(error.message) }
    }
  }),
)
if (failures) {
  console.error(`${failures} repos failed; previous results retained. Fix the errors and resume.`)
  process.exitCode = 1
}
