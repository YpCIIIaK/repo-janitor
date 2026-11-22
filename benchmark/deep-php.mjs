#!/usr/bin/env node
/**
 * Run the deep PHP engine (php-taint) over the PHP part of the corpus, kept
 * apart from the regular results so it can be measured before it is trusted.
 *
 *   node benchmark/deep-php.mjs [--min-files 20] [--jobs 4] [--out dir] [--repos names.json] [--cli path]
 *
 * For each corpus repo with at least --min-files PHP files (from its inventory):
 * a blob-filtered sparse checkout of *.php at the pinned sha, `scan --only
 * php-taint`, findings written to benchmark/.deep-php/<repo>.json, clone dropped.
 * Done repos are skipped, so a run that stops resumes. BENCH_SHARD splits it.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { inShard } from "./shard.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
// --out keeps a re-measurement apart from the first run; --repos limits it to a JSON list of names.
const outDir = arg("out", join(here, ".deep-php"))
const cli = arg("cli", join(root, "packages/cli/dist/index.js"))
const only = arg("repos", null) ? new Set(JSON.parse(readFileSync(arg("repos"), "utf8"))) : null
const minFiles = Number(arg("min-files", 20))
const jobs = Number(arg("jobs", 4))

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)))
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeout ?? 600_000)
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, err }) })
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, err: e.message }) })
  })
}

export function phpRepos(corpus, min) {
  return corpus.filter((r) => {
    const p = join(here, ".inventory", `${r.name}.json`)
    if (!existsSync(p)) return false
    try { return (JSON.parse(readFileSync(p, "utf8")).exts?.php ?? 0) >= min } catch { return false }
  })
}

async function one(repo) {
  const out = join(outDir, `${repo.name}.json`)
  if (existsSync(out)) return "skip"
  const dir = mkdtempSync(join(tmpdir(), "deep-php-"))
  try {
    const git = (...a) => sh("git", ["-C", dir, ...a], { timeout: 600_000 })
    await git("init", "-q")
    await git("sparse-checkout", "set", "--no-cone", "*.php", "*.inc", "*.phtml")
    const f = await git("fetch", "-q", "--depth", "1", "--filter=blob:none", repo.url, repo.sha)
    if (f.code !== 0) return `fetch failed: ${f.err.trim().split("\n").pop()}`
    await git("checkout", "-q", "FETCH_HEAD")
    const report = join(dir, ".deep-report.json")
    const started = Date.now()
    const s = await sh(process.execPath, [cli, "scan", dir, "--only", "php-taint", "--all", "-f", "json", "-o", report], { timeout: 900_000 })
    if (!existsSync(report)) return `scan failed (${s.code}): ${s.err.trim().split("\n").pop()}`
    const r = JSON.parse(readFileSync(report, "utf8"))
    const findings = [...(r.issues ?? []), ...(r.lowConfidence ?? [])]
    writeFileSync(out, JSON.stringify({ repo: repo.name, sha: repo.sha, ms: Date.now() - started, findings }) + "\n")
    return `${findings.length} findings  ${Math.round((Date.now() - started) / 1000)}s`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(cli)) throw new Error("build the CLI first: pnpm run build:packages")
  mkdirSync(outDir, { recursive: true })
  const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
  const queue = inShard(phpRepos(corpus, minFiles).filter((r) => !only || only.has(r.name)))
  console.log(`${queue.length} PHP repos (≥${minFiles} PHP files)`)
  let next = 0
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < queue.length) {
      const repo = queue[next++]
      const res = await one(repo).catch((e) => `error: ${e.message}`)
      if (res !== "skip") console.log(`${repo.name.padEnd(40)} ${res}`)
    }
  }))
}
