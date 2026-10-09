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
import { spawnSync } from "node:child_process"
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

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts })

if (!existsSync(cli)) {
  console.error("Build the CLI first: pnpm run build:cli")
  process.exit(1)
}
mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

for (const repo of corpus) {
  if (only.length && !only.includes(repo.name)) continue
  const dir = join(cacheDir, repo.name)
  if (!existsSync(dir)) {
    const c = sh("git", ["clone", "--quiet", "--no-checkout", repo.url, dir])
    if (c.status !== 0) {
      console.error(`clone failed: ${repo.name}\n${c.stderr}`)
      continue
    }
  }
  const co = sh("git", ["-C", dir, "checkout", "--quiet", "--force", repo.sha])
  if (co.status !== 0) {
    console.error(`checkout failed: ${repo.name}\n${co.stderr}`)
    continue
  }
  const reportPath = join(outDir, `${repo.name}.report.json`)
  const started = Date.now()
  const scan = sh("node", [cli, "scan", dir, "--format", "json", "--output", reportPath], {
    env: { ...process.env, REPO_ANTI_ROT_OFFLINE: "1" },
  })
  if (scan.status !== 0 && scan.status !== 2) {
    console.error(`scan failed: ${repo.name}\n${scan.stderr.slice(-2000)}`)
    continue
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  const findings = report.issues.map((i) => ({
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
  console.log(`${repo.name.padEnd(20)} ${String(findings.length).padStart(5)} findings  ${((Date.now() - started) / 1000).toFixed(0)}s`)
}
