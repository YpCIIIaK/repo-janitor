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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
    p.on("close", (status) => resolve({ status, stdout, stderr }))
  })
}

async function runOne(repo) {
  const dir = join(cacheDir, repo.name)
  if (!existsSync(dir)) {
    const c = await sh2("git", ["clone", "--quiet", "--no-checkout", repo.url, dir])
    if (c.status !== 0) return console.error(`clone failed: ${repo.name}\n${c.stderr}`)
  }
  let co = await sh2("git", ["-C", dir, "checkout", "--quiet", "--force", repo.sha])
  if (co.status !== 0) {
    await sh2("git", ["-C", dir, "fetch", "--quiet", "origin", repo.sha])
    co = await sh2("git", ["-C", dir, "checkout", "--quiet", "--force", repo.sha])
    if (co.status !== 0) return console.error(`checkout failed: ${repo.name}\n${co.stderr}`)
  }
  const reportPath = join(outDir, `${repo.name}.report.json`)
  const started = Date.now()
  const scan = await sh2("node", [cli, "scan", dir, "--format", "json", "--output", reportPath], {
    env: { ...process.env, REPO_ANTI_ROT_OFFLINE: "1" },
  })
  if (scan.status !== 0 && scan.status !== 2) return console.error(`scan failed: ${repo.name}\n${scan.stderr}`)
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  // The benchmark judges every rule, including the ones shipped as low confidence.
  const findings = [...report.issues, ...(report.lowConfidence ?? [])].map((i) => ({
    id: i.id,
    scanner: i.scanner,
    rule: i.rule,
    severity: i.severity,
    title: i.title,
    location: i.location,
    detail: i.detail,
    evidence: i.evidence,
  }))
  writeFileSync(join(outDir, `${repo.name}.json`), JSON.stringify({ repo: repo.name, sha: repo.sha, findings }, null, 1))
  console.log(`${repo.name.padEnd(28)} ${String(findings.length).padStart(5)} findings  ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

const queue = corpus.filter((r) => !only.length || only.includes(r.name))
const workers = Number(process.env.BENCH_JOBS ?? 6)
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (queue.length) await runOne(queue.shift())
  }),
)
