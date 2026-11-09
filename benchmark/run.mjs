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
import { availableParallelism } from "node:os"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { newestSource, scanFingerprint, scannerFingerprints, staleScanners } from "./fingerprint.mjs"
import { readInventory, writeInventory } from "./inventory.mjs"
import { mayProduce, sparseGlobs } from "./scanner-inputs.mjs"

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
// A CLI older than the sources it was built from would scan with old rules
// while stamping results with the new fingerprint.
if (statSync(cli).mtimeMs < newestSource()) {
  console.error("The CLI is older than packages/core or packages/cli sources: pnpm run build:cli")
  process.exit(1)
}
const fingerprint = scanFingerprint()
const fps = scannerFingerprints()
// Merging a partial scan needs the engine's own score function.
const coreDist = join(root, "packages", "core", "dist", "index.js")
if (!existsSync(coreDist) || statSync(coreDist).mtimeMs < newestSource()) {
  console.error("The core build is older than its sources: pnpm run build:packages")
  process.exit(1)
}
const { computeScore, scoreToGrade } = await import(coreDist)
const forced = (process.env.BENCH_FORCE_SCANNERS ?? "").split(",").filter(Boolean)
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return null }
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
  const resultPath0 = join(outDir, `${repo.name}.json`)
  const reportPath0 = join(outDir, `${repo.name}.report.json`)
  const prevResult = readJson(resultPath0)
  const prevReport = readJson(reportPath0)
  // Which scanners to run: all, none, or only those whose code changed.
  let only = process.env.BENCH_FULL === "1" ? null : staleScanners(prevResult, repo.sha, fps, fingerprint)
  if (forced.length && prevResult?.sha === repo.sha) only = forced
  if (only && !prevReport) only = null
  // Skip scanners that cannot find anything here: none of their input files in
  // the repo, and no finding from them last time. They are marked current.
  const inv = readInventory(repo.name, repo.sha)
  if (only && only.length && inv && !forced.length) {
    const hadFindings = new Set((prevResult?.findings ?? []).map((f) => f.scanner))
    only = only.filter((id) => mayProduce(id, inv) || hadFindings.has(id))
  }
  if (only && only.length === 0) {
    if (!prevResult.scanners || Object.keys(fps.scanners).some((id) => prevResult.scanners[id] !== fps.scanners[id])) {
      writeFileSync(resultPath0, JSON.stringify({ ...prevResult, base: fps.base, scanners: fps.scanners }, null, 1))
    }
    console.log(`${repo.name.padEnd(28)} current`)
    return
  }
  // A targeted rerun of scanners that read only named files and need no history
  // (beyond a line's age, kept from the previous result) fetches just those
  // files: a depth-1, blob-less clone with a sparse checkout. A full scan, or
  // any scanner with broad inputs, takes the normal full clone.
  const globs = only && only.length && process.env.BENCH_SPARSE !== "0" ? sparseGlobs(only) : null
  if (globs) {
    const sdir = join(cacheDir, `${repo.name}.sparse`)
    rmSync(sdir, { recursive: true, force: true })
    try {
      await sh2("git", ["init", "--quiet", sdir])
      await sh2("git", ["-C", sdir, "remote", "add", "origin", repo.url])
      await sh2("git", ["-C", sdir, "sparse-checkout", "set", "--no-cone", ...globs])
      let f
      for (let attempt = 0; attempt < 4; attempt++) {
        f = await sh2("git", ["-C", sdir, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", repo.sha])
        if (f.status === 0) break
        await new Promise((r) => setTimeout(r, 15000 * 2 ** attempt))
      }
      if (f.status !== 0) throw new Error(`sparse fetch failed: ${repo.name}\n${f.stderr}`)
      const co = await sh2("git", ["-C", sdir, "-c", "core.longpaths=true", "checkout", "--quiet", "FETCH_HEAD"])
      if (co.status !== 0) throw new Error(`sparse checkout failed: ${repo.name}\n${co.stderr}`)
      return await scanAndStore(repo, sdir, only, prevResult, prevReport, inv, true)
    } finally {
      rmSync(sdir, { recursive: true, force: true })
    }
  }
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
  // A website repo with years of built HTML (apache/spark-website) is 24 GB and
  // fills the disk for every other worker. Refuse anything over BENCH_MAX_MB.
  const maxMb = Number(process.env.BENCH_MAX_MB ?? 2000)
  const objs = await sh2("git", ["-C", dir, "count-objects", "-v"])
  const packKb = Number(/size-pack: (\d+)/.exec(objs.stdout)?.[1] ?? 0) + Number(/^size: (\d+)/m.exec(objs.stdout)?.[1] ?? 0)
  if (packKb / 1024 > maxMb) throw new Error(`too large: ${repo.name} (${Math.round(packKb / 1024)} MB > BENCH_MAX_MB=${maxMb})`)
  let co = await sh2("git", ["-C", dir, "-c", "core.longpaths=true", "checkout", "--quiet", "--force", repo.sha])
  if (co.status !== 0) {
    await sh2("git", ["-C", dir, "fetch", "--quiet", "origin", repo.sha])
    co = await sh2("git", ["-C", dir, "-c", "core.longpaths=true", "checkout", "--quiet", "--force", repo.sha])
    if (co.status !== 0) throw new Error(`checkout failed: ${repo.name}\n${co.stderr}`)
  }
  return await scanAndStore(repo, dir, only, prevResult, prevReport, inv, false)
}

/** Scan a checked-out tree, merge a partial scan with the cached result, store. */
async function scanAndStore(repo, dir, only, prevResult, prevReport, inv, sparse) {
  if (!inv && !sparse) {
    const ls = await sh2("git", ["-C", dir, "ls-tree", "-r", "--name-only", repo.sha])
    if (ls.status === 0) writeInventory(repo.name, ls.stdout.split("\n"), repo.sha)
  }
  const reportPath = join(outDir, `${repo.name}.report.json`)
  const pendingReport = `${reportPath}.pending`
  const started = Date.now()
  const scan = await sh2("node", [cli, "scan", dir, ...(only ? ["--only", only.join(",")] : []), "--format", "json", "--output", pendingReport], {
    env: { ...process.env, REPO_ANTI_ROT_OFFLINE: "1" },
  })
  if (scan.status !== 0 && scan.status !== 2) throw new Error(`scan failed: ${repo.name}\n${scan.stderr}`)
  let report = JSON.parse(readFileSync(pendingReport, "utf8"))
  if (report.diagnostics?.failedScanners?.length) {
    throw new Error(`incomplete scan: ${repo.name}: ${JSON.stringify(report.diagnostics.failedScanners)}`)
  }
  if (only) {
    // Keep the cached findings of every scanner that did not rerun, take the
    // fresh ones from those that did, and score the union as the engine would.
    const rerun = new Set(only)
    const kept = [...(prevReport.issues ?? []), ...(prevReport.lowConfidence ?? [])].filter((i) => !rerun.has(i.scanner))
    // A shallow checkout cannot blame a line's real age; keep the age a finding
    // had last time (ages are display only, they never change what is found).
    const prevAge = new Map([...(prevReport.issues ?? []), ...(prevReport.lowConfidence ?? [])].map((i) => [i.id, i.ageDays]))
    const fresh = [...(report.issues ?? []), ...(report.lowConfidence ?? [])].map((i) => (sparse && prevAge.has(i.id) ? { ...i, ageDays: prevAge.get(i.id) } : i))
    const all = [...kept, ...fresh]
    const confident = all.filter((i) => i.confidence !== "low")
    const low = all.filter((i) => i.confidence === "low")
    const score = computeScore(confident, report.config?.weights)
    const prevDiag = prevReport.diagnostics ?? {}
    report = {
      ...report,
      score,
      grade: scoreToGrade(score),
      issues: confident,
      ...(low.length ? { lowConfidence: low } : {}),
      diagnostics: {
        ...report.diagnostics,
        completedScanners: [...new Set([...(prevDiag.completedScanners ?? []), ...only])],
        durations: { ...(prevDiag.durations ?? {}), ...(report.diagnostics?.durations ?? {}) },
      },
    }
    if (!low.length) delete report.lowConfidence
    writeFileSync(pendingReport, JSON.stringify(report))
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
  writeFileSync(
    `${resultPath}.pending`,
    JSON.stringify({ repo: repo.name, sha: repo.sha, fingerprint, base: fps.base, scanners: fps.scanners, seconds: only ? prevResult?.seconds : Math.round((Date.now() - started) / 1000), ...(only ? { rerun: only } : {}), findings }, null, 1),
  )
  renameSync(pendingReport, reportPath)
  renameSync(`${resultPath}.pending`, resultPath)
  // The checkout is only needed while scanning: the next run restores it from
  // .git with `checkout --force`. Keeping 500 working trees fills the disk.
  // BENCH_DROP_CLONES=1 removes the whole clone (the next run clones again by SHA),
  // so a corpus far larger than the disk can still be scanned one repo at a time.
  if (sparse) {
    // The sparse clone is removed by the caller; it must not feed history.
  } else if (process.env.BENCH_DROP_CLONES === "1") {
    await sh2("node", [join(here, "history.mjs"), repo.name])
    rmSync(dir, { recursive: true, force: true })
  }
  else if (process.env.BENCH_KEEP_TREES !== "1") {
    for (const entry of readdirSync(dir)) if (entry !== ".git") rmSync(join(dir, entry), { recursive: true, force: true })
  }
  console.log(`${repo.name.padEnd(28)} ${String(findings.length).padStart(5)} findings  ${((Date.now() - started) / 1000).toFixed(0)}s${sparse ? " (sparse)" : ""}`)
}


// Heaviest repos first, by last scan time (or size when never timed): one
// 20-minute repo started last would otherwise hold the whole run open.
const weight = (r) => {
  const p = join(outDir, `${r.name}.json`)
  if (existsSync(p)) {
    try {
      const prev = JSON.parse(readFileSync(p, "utf8"))
      if (typeof prev.seconds === "number") return prev.seconds
    } catch { /* fall through */ }
  }
  const rp = join(outDir, `${r.name}.report.json`)
  if (existsSync(rp)) {
    try { return (JSON.parse(readFileSync(rp, "utf8")).metrics?.linesOfCode ?? 0) / 5000 } catch { /* unknown */ }
  }
  return 0
}
const queue = corpus.filter((r) => !only.length || only.includes(r.name)).map((r) => [r, weight(r)]).sort((a, b) => b[1] - a[1]).map(([r]) => r)
// One scan per core: scans are CPU-bound, and six jobs on four cores measured
// slower (about 770 repos/h) than four (about 890).
const workers = Number(process.env.BENCH_JOBS ?? availableParallelism())
if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw new Error("BENCH_JOBS must be an integer from 1 to 32")
let failures = 0
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (queue.length) {
      const repo = queue.shift()
      try { await runOne(repo) }
      catch (error) {
        failures++
        console.error(error.message)
        // A failed repo must not leave its clone behind when clones are dropped.
        if (process.env.BENCH_DROP_CLONES === "1") rmSync(join(cacheDir, repo.name), { recursive: true, force: true })
      }
    }
  }),
)
if (failures) {
  console.error(`${failures} repos failed; previous results retained. Fix the errors and resume.`)
  process.exitCode = 1
}
