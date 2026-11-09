#!/usr/bin/env node
/**
 * Fast regression check for a scanner change, in minutes instead of a rescan.
 *
 * The replay set is the source files behind every hand-labelled finding, plus
 * the whole source of each deliberately vulnerable app. Each repo's files are
 * written to a scratch directory and only the scanners under test are run on
 * it. That suits scanners that judge a file on its own (insecure-code,
 * commented-code, dockerfile, iac-security, workflow-security…); scanners that
 * need git history or the whole repo do not replay faithfully — `baseline`
 * measures that per scanner, and their gate stays the partial rescan.
 *
 *   node benchmark/replay.mjs build              snapshot the files (blob-less clones) → .replay/
 *   node benchmark/replay.mjs baseline [--only a,b]   run current code, record what it finds, print fidelity
 *   node benchmark/replay.mjs check [--only a,b]      run again, compare with the baseline:
 *                                                     labelled TP lost (fails), FP removed, vulnerable-app
 *                                                     high findings lost (fails)
 *
 * Typical loop: baseline → edit the scanner → pnpm run build:cli → check.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const cli = join(root, "packages", "cli", "dist", "index.js")
const replayDir = join(here, ".replay")
const baselinePath = join(replayDir, "baseline.json")
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const VULN = /goat|dvwa|dvna|dvws|vulnerab|juice-shop|vampi|dvga|pygoat|vulpy|govwa|crapi|xvwa|hackademic|vulnlab|vulnado|wrongsecrets|serverless-goat|sadcloud|cloudgoat|dvia|dsvw|inject-some-sql|testbed|terracotta|restaurant|awsgoat|webgoatphp|benchmarkjava/i
const SRC = /\.(ts|tsx|js|jsx|mjs|cjs|py|php|phtml|inc|java|kt|kts|scala|rb|erb|go|cs|cshtml|rs|c|cc|cpp|h|hpp|swift|tf|ya?ml|json|xml|html)$|(^|\/)Dockerfile[^/]*$/i
const VENDORED = /(^|\/)(node_modules|vendor|third_party|dist|build)\//
const MAX_VULN_FILES = 3000
const MAX_FILE_BYTES = 400_000

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
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return null }
}
const fileOf = (loc) => (loc ?? "").replace(/:\d+(:\d+)?$/, "")

/** Repos in the replay set, with the files each needs. */
function plan() {
  const out = []
  for (const r of corpus) {
    const labels = readJson(join(here, "labels", `${r.name}.json`)) ?? {}
    const res = readJson(join(here, ".results", `${r.name}.json`))
    if (!res) continue
    const files = new Set(res.findings.filter((f) => labels[f.id]).map((f) => fileOf(f.location)).filter((f) => f && /\.|Dockerfile/.test(f)))
    const vuln = VULN.test(r.name)
    if (files.size || vuln) out.push({ repo: r, files: [...files], vuln })
  }
  return out
}

async function snapshot({ repo, files, vuln }, work) {
  const dir = join(work, repo.name)
  rmSync(dir, { recursive: true, force: true })
  try {
    const c = await sh("git", ["clone", "--quiet", "--bare", "--filter=blob:none", repo.url, dir])
    if (c.status !== 0) throw new Error("clone failed")
    if ((await sh("git", ["-C", dir, "cat-file", "-e", `${repo.sha}^{commit}`])).status !== 0) {
      await sh("git", ["-C", dir, "fetch", "--quiet", "--filter=blob:none", "origin", repo.sha])
    }
    let wanted = new Set(files)
    if (vuln) {
      // Thousands of files: one shallow pack of the pinned tree beats fetching blob by blob.
      await sh("git", ["-C", dir, "fetch", "--quiet", "--no-filter", "--depth=1", "origin", repo.sha])
      const tree = (await sh("git", ["-C", dir, "ls-tree", "-r", "--name-only", repo.sha])).out.split("\n")
      for (const f of tree.filter((f) => SRC.test(f) && !VENDORED.test(f)).slice(0, MAX_VULN_FILES)) wanted.add(f)
    }
    const contents = {}
    for (const f of wanted) {
      const r = await sh("git", ["-C", dir, "show", `${repo.sha}:${f}`])
      if (r.status === 0 && r.out.length <= MAX_FILE_BYTES) contents[f] = r.out
    }
    writeFileSync(join(replayDir, `${repo.name}.json.gz`), gzipSync(JSON.stringify({ sha: repo.sha, vuln, files: contents })))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function build() {
  mkdirSync(replayDir, { recursive: true })
  const work = join(here, ".replaycache")
  mkdirSync(work, { recursive: true })
  const queue = plan().filter((p) => {
    const prev = existsSync(join(replayDir, `${p.repo.name}.json.gz`)) ? JSON.parse(gunzipSync(readFileSync(join(replayDir, `${p.repo.name}.json.gz`)))) : null
    return !prev || prev.sha !== p.repo.sha || p.files.some((f) => !(f in prev.files))
  })
  console.log(`${queue.length} repos to snapshot`)
  let failures = 0
  await Promise.all(Array.from({ length: availableParallelism() * 2 }, async () => {
    while (queue.length) {
      const p = queue.shift()
      try { await snapshot(p, work) } catch (e) { failures++; console.error(`${p.repo.name}: ${e.message}`) }
    }
  }))
  console.log(failures ? `${failures} failed` : "replay set built")
}

/** Run the selected scanners on every snapshot; returns repo → finding ids. */
async function run(only) {
  if (!existsSync(cli)) throw new Error("build the CLI first: pnpm run build:cli")
  const items = plan().map((p) => p.repo).filter((r) => existsSync(join(replayDir, `${r.name}.json.gz`)))
  const found = {}
  const queue = [...items]
  await Promise.all(Array.from({ length: availableParallelism() }, async () => {
    while (queue.length) {
      const r = queue.shift()
      const snap = JSON.parse(gunzipSync(readFileSync(join(replayDir, `${r.name}.json.gz`))))
      const dir = mkdtempSync(join(tmpdir(), "replay-"))
      try {
        for (const [f, text] of Object.entries(snap.files)) {
          mkdirSync(dirname(join(dir, f)), { recursive: true })
          writeFileSync(join(dir, f), text)
        }
        const outFile = join(dir, ".replay-report.json")
        const args = [cli, "scan", dir, "--format", "json", "--output", outFile, ...(only.length ? ["--only", only.join(",")] : [])]
        const res = await sh("node", args, { env: { ...process.env, REPO_ANTI_ROT_OFFLINE: "1" } })
        const rep = readJson(outFile)
        if (!rep) { console.error(`${r.name}: scan failed ${res.err.split("\n").pop()}`); continue }
        found[r.name] = [...(rep.issues ?? []), ...(rep.lowConfidence ?? [])].map((i) => `${i.scanner}\t${i.id}\t${i.confidence}`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }))
  return found
}

function stored(r) {
  return readJson(join(here, ".results", `${r.name}.json`))?.findings ?? []
}

async function baseline(only) {
  const started = Date.now()
  const found = await run(only)
  const fidelity = {}
  // Fidelity: of the stored findings in replayed files, how many does the replay reproduce?
  const per = {}
  for (const p of plan()) {
    const got = new Set((found[p.repo.name] ?? []).map((x) => x.split("\t")[1]))
    const files = new Set(p.vuln ? Object.keys(JSON.parse(gunzipSync(readFileSync(join(replayDir, `${p.repo.name}.json.gz`)))).files) : p.files)
    for (const f of stored(p.repo)) {
      if (only.length && !only.includes(f.scanner)) continue
      if (!files.has(fileOf(f.location))) continue
      const row = (per[f.scanner] ??= { stored: 0, reproduced: 0 })
      row.stored++
      if (got.has(f.id)) row.reproduced++
    }
  }
  for (const [k, v] of Object.entries(per)) fidelity[k] = Number((v.reproduced / v.stored).toFixed(3))
  writeFileSync(baselinePath, JSON.stringify({ only, found, fidelity }))
  console.log(`baseline recorded in ${Math.round((Date.now() - started) / 1000)} s`)
  console.log("fidelity (stored findings in replayed files that the replay reproduces):")
  for (const [k, v] of Object.entries(per).sort((a, b) => b[1].stored - a[1].stored)) {
    console.log(`  ${k.padEnd(20)} ${String(Math.round((100 * v.reproduced) / v.stored)).padStart(3)}%  (${v.reproduced}/${v.stored})`)
  }
}

async function check(only) {
  const base = readJson(baselinePath)
  if (!base) throw new Error("no baseline: run `replay.mjs baseline` before changing the scanner")
  const started = Date.now()
  const found = await run(only.length ? only : base.only)
  const scope = (scanner) => !(only.length ? only : base.only).length || (only.length ? only : base.only).includes(scanner)
  let tpLost = []
  let fpRemoved = 0
  let fpTotal = 0
  let vulnLost = []
  let added = 0
  for (const p of plan()) {
    const labels = readJson(join(here, "labels", `${p.repo.name}.json`)) ?? {}
    const before = new Set((base.found[p.repo.name] ?? []).map((x) => x.split("\t")[1]))
    const beforeHigh = new Set((base.found[p.repo.name] ?? []).filter((x) => x.endsWith("\thigh") && scope(x.split("\t")[0])).map((x) => x.split("\t")[1]))
    const now = new Set((found[p.repo.name] ?? []).map((x) => x.split("\t")[1]))
    for (const x of found[p.repo.name] ?? []) if (!before.has(x.split("\t")[1])) added++
    for (const [id, v] of Object.entries(labels)) {
      if (!before.has(id)) continue // not reproduced by replay even before the change
      const scanner = (base.found[p.repo.name] ?? []).find((x) => x.split("\t")[1] === id)?.split("\t")[0]
      if (!scope(scanner) || (base.fidelity?.[scanner] ?? 0) < 0.95) continue
      if (v === "tp" && !now.has(id)) tpLost.push(`${p.repo.name} ${id}`)
      if (v === "fp") { fpTotal++; if (!now.has(id)) fpRemoved++ }
    }
    if (p.vuln) for (const id of beforeHigh) if (!now.has(id)) vulnLost.push(`${p.repo.name} ${id}`)
  }
  console.log(`checked in ${Math.round((Date.now() - started) / 1000)} s`)
  // Only scanners the replay reproduces faithfully can be judged here.
  const TRUST = 0.95
  const scanners = only.length ? only : base.only.length ? base.only : Object.keys(base.fidelity ?? {})
  const weak = scanners.filter((k) => (base.fidelity?.[k] ?? 0) < TRUST)
  if (weak.length) console.log(`not judged here (replay fidelity < 95%; use a partial rescan): ${weak.join(", ")}`)
  console.log(`labelled FP removed: ${fpRemoved} of ${fpTotal}`)
  console.log(`new findings (unlabelled, review a sample): ${added}`)
  console.log(`labelled TP lost: ${tpLost.length}`)
  for (const x of tpLost.slice(0, 20)) console.log(`  ${x}`)
  console.log(`vulnerable-app high findings lost: ${vulnLost.length}`)
  for (const x of vulnLost.slice(0, 20)) console.log(`  ${x}`)
  process.exitCode = tpLost.length || vulnLost.length ? 1 : 0
}

const [cmd, ...rest] = process.argv.slice(2)
const oi = rest.indexOf("--only")
const only = oi >= 0 ? rest[oi + 1].split(",").filter(Boolean) : []
if (cmd === "build") await build()
else if (cmd === "baseline") await baseline(only)
else if (cmd === "check") await check(only)
else {
  console.error("usage: replay.mjs build | baseline [--only a,b] | check [--only a,b]")
  process.exit(1)
}
