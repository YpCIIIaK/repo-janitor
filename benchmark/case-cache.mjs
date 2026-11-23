#!/usr/bin/env node
/**
 * Local cache of labelled vulnerability cases: download once, scan many times.
 *
 *   node benchmark/case-cache.mjs index  [--osv dir]                 all usable advisories → index.json
 *   node benchmark/case-cache.mjs fetch  [--lang python] [--class sqli] [--limit 200] [--jobs 8]
 *   node benchmark/case-cache.mjs select --out cases.json [--lang …] [--class …] [--kind app|lib] [--per 30] [--seed N]
 *   node benchmark/case-cache.mjs stats
 *
 * Layout under $RJ_CASE_CACHE (default ~/.cache/rj-cases):
 *   osv/<Ecosystem>.zip         OSV bulk exports (https://osv-vulnerabilities.storage.googleapis.com/<eco>/all.zip)
 *   index.json                  every usable GHSA advisory as a recall case (recall-advisories.mjs caseOf)
 *   snap/<id>.tar.gz            the vulnerable tree: sources of the case's language and manifests (no vendored code, no file over 1 MB)
 *   snap/<id>.patch             the fix as a patch on that tree: the fixed tree is the snapshot + patch
 *   meta/<id>.json              what the fix touched, the removed lines, app or library, or why the case is unusable
 *
 * recall.mjs reads a case from here when its snapshot exists and builds it on first use otherwise.
 * The cache is local and private: nothing in it goes to the public repo.
 */
import { spawn, spawnSync } from "node:child_process"
import { setTimeout, clearTimeout } from "node:timers"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { caseOf, ECOSYSTEM_LANGUAGE } from "./recall-advisories.mjs"

export const CACHE = process.env.RJ_CASE_CACHE ?? join(homedir(), ".cache", "rj-cases")
const SNAP = join(CACHE, "snap")
const META = join(CACHE, "meta")

const LANG_FILE = {
  python: /\.py$/i,
  javascript: /\.(?:[cm]?jsx?|tsx?)$/i,
  php: /\.(?:php|phtml|inc)$/i,
}
const SKIP_DIR = /(?:^|\/)(?:node_modules|vendor|third[-_]?party|site-packages|\.venv|venv|dist|build|bower_components)\//
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec|testing|fixtures?)\/|(?:^|\/)(?:test_[^/]*|[^/]*_test|[^/]*\.(?:test|spec))\.[a-z]+$/i
const MAX_FILE = 1 << 20
const MANIFEST = /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.(?:py|cfg)|Pipfile|composer\.json|tsconfig\.json)$/
/** A touched file that serves requests: the case is an application bug, not a library API. */
const SERVES = {
  python: /\b(?:request\.(?:args|form|GET|POST|json|values|files|cookies|query_params|data)|@\w+\.(?:route|get|post|put|delete)\(|RequestHandler|get_argument\(|HttpResponse|APIRouter|Blueprint\()/,
  javascript: /\b(?:req\.(?:query|body|params|cookies|headers)|ctx\.(?:query|request|params)|(?:app|router)\.(?:get|post|put|delete|all|use)\(|express\(\)|fastify|NextRequest|searchParams)/,
  php: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b|Route::|->input\(|\$request->/,
}

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const git = (dir, args, opts = {}) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 600_000, ...opts })
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.error?.message || "").trim().slice(0, 200)}`)
  return r.stdout
}

export const snapshotOf = (id) => ({ tar: join(SNAP, `${id}.tar.gz`), patch: join(SNAP, `${id}.patch`), meta: join(META, `${id}.json`) })
export const hasSnapshot = (id) => existsSync(snapshotOf(id).meta)
export const readMeta = (id) => (hasSnapshot(id) ? JSON.parse(readFileSync(snapshotOf(id).meta, "utf8")) : null)

/** Lines of the old side a unified diff removes or changes, per file. */
export function removedLines(patch) {
  const out = {}
  let file = null, line = 0
  for (const l of patch.split("\n")) {
    if (l.startsWith("--- ")) { file = l === "--- /dev/null" ? null : l.slice(6); continue }
    if (l.startsWith("+++ ")) continue
    const h = /^@@ -(\d+)/.exec(l)
    if (h) { line = Number(h[1]); continue }
    if (!file) continue
    if (l.startsWith("-")) { (out[file] ??= []).push(line); line++ }
    else if (l.startsWith(" ")) line++
  }
  return out
}

/** Download one case and store it as snapshot + patch + meta. Throws only on network/git failure. */
export function buildSnapshot(c) {
  mkdirSync(SNAP, { recursive: true }); mkdirSync(META, { recursive: true })
  const paths = snapshotOf(c.id)
  const d = mkdtempSync(join(tmpdir(), "rjcase-"))
  try {
    git(d, ["init", "-q"])
    git(d, ["fetch", "-q", "--depth", "2", c.source.url, c.source.fixed])
    git(d, ["checkout", "-q", "FETCH_HEAD^"])
    const langRe = LANG_FILE[c.language]
    const listed = git(d, ["ls-tree", "-r", "-l", "--full-tree", "HEAD"]).split("\n").filter(Boolean).map((l) => {
      const m = /^\d+ blob \w+\s+(\d+|-)\t(.*)$/.exec(l)
      return m ? { size: Number(m[1]) || 0, path: m[2] } : null
    }).filter(Boolean)
    // Only what the scanners judge: sources of the case's language and the manifests next to them.
    const keep = listed.filter((f) => f.size <= MAX_FILE && !SKIP_DIR.test(f.path) && (langRe?.test(f.path) || MANIFEST.test(f.path))).map((f) => f.path)
    const changed = git(d, ["diff", "--name-only", "HEAD", "FETCH_HEAD"]).split("\n").filter(Boolean)
    const langChanged = changed.filter((f) => langRe?.test(f) && !TEST_FILE.test(f) && !SKIP_DIR.test(f))
    const keepSet = new Set(keep)
    const patch = git(d, ["diff", "--binary", "HEAD", "FETCH_HEAD", "--", ...changed.filter((f) => keepSet.has(f) || (!listed.some((x) => x.path === f) && (langRe?.test(f) || MANIFEST.test(f))))])
    const list = join(d, ".rj-files")
    writeFileSync(list, keep.join("\n") + "\n")
    const t = spawnSync("tar", ["-czf", paths.tar, "-C", d, "--no-recursion", "-T", list], { maxBuffer: 1 << 26 })
    if (t.status !== 0) throw new Error(`tar: ${String(t.stderr).slice(0, 200)}`)
    writeFileSync(paths.patch, patch)
    const removed = removedLines(git(d, ["diff", "-U0", "HEAD", "FETCH_HEAD", "--", ...langChanged]) || "")
    const serves = SERVES[c.language]
    const app = langChanged.some((f) => { try { return serves?.test(readFileSync(join(d, f), "utf8")) } catch { return false } })
    const meta = {
      id: c.id, language: c.language, class: c.class, url: c.source.url, fixed: c.source.fixed,
      files: keep.length, bytes: statSync(paths.tar).size, changed, langChanged, removed,
      kind: app ? "app" : "lib",
      skip: langChanged.length ? null : "fix touches no source files of the case's language",
      at: new Date().toISOString(),
    }
    writeFileSync(paths.meta, JSON.stringify(meta) + "\n")
    return meta
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

/** The case's tree on one side, unpacked under `root`: "vulnerable" is the snapshot, "fixed" adds the patch. */
export function materialize(c, side, root) {
  if (!hasSnapshot(c.id)) buildSnapshot(c)
  const p = snapshotOf(c.id)
  const d = join(root, `${c.id}-${side}`)
  if (existsSync(join(d, ".rj-ready"))) return d
  rmSync(d, { recursive: true, force: true })
  mkdirSync(d, { recursive: true })
  const t = spawnSync("tar", ["-xzf", p.tar, "-C", d])
  if (t.status !== 0) throw new Error(`untar ${c.id}: ${String(t.stderr).slice(0, 200)}`)
  // Scanners read history through git: one commit keeps them working.
  spawnSync("git", ["-C", d, "init", "-q"])
  if (side === "fixed" && statSync(p.patch).size) {
    const a = spawnSync("git", ["-C", d, "apply", "--whitespace=nowarn", p.patch], { encoding: "utf8" })
    if (a.status !== 0) throw new Error(`patch ${c.id}: ${a.stderr.slice(0, 200)}`)
  }
  spawnSync("git", ["-C", d, "add", "-A"])
  spawnSync("git", ["-C", d, "-c", "user.name=rj", "-c", "user.email=rj@localhost", "commit", "-qm", side, "--no-gpg-sign"])
  writeFileSync(join(d, ".rj-ready"), "")
  return d
}

function loadIndex() {
  const f = join(CACHE, "index.json")
  if (!existsSync(f)) throw new Error(`no ${f}: run "case-cache.mjs index" first`)
  return JSON.parse(readFileSync(f, "utf8"))
}

function filterCases(all) {
  const lang = arg("lang"), cls = arg("class")
  return all.filter((c) => (!lang || lang.split(",").includes(c.language)) && (!cls || cls.split(",").includes(c.class)))
}

const key = (seed, c) => createHash("sha1").update(`${seed}:${c.id}`).digest("hex")

async function main() {
  const cmd = process.argv[2]
  if (cmd === "index") {
    const osv = arg("osv", join(CACHE, "osv"))
    const all = []
    for (const eco of Object.keys(ECOSYSTEM_LANGUAGE)) {
      const zip = join(osv, `${eco}.zip`)
      if (!existsSync(zip)) continue
      const dir = mkdtempSync(join(tmpdir(), "rjosv-"))
      spawnSync("unzip", ["-q", "-o", zip, "GHSA-*", "-d", dir])
      for (const f of readdirSync(dir)) {
        const adv = JSON.parse(readFileSync(join(dir, f), "utf8"))
        const c = caseOf(adv, eco)
        if (c) all.push({ ...c, package: adv.affected?.[0]?.package?.name, published: adv.published, summary: (adv.summary ?? "").slice(0, 160) })
      }
      rmSync(dir, { recursive: true, force: true })
    }
    writeFileSync(join(CACHE, "index.json"), JSON.stringify(all) + "\n")
    const by = {}
    for (const c of all) by[`${c.language}/${c.class}`] = (by[`${c.language}/${c.class}`] ?? 0) + 1
    console.log(`${all.length} usable advisories`)
    console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join("\n"))
    return
  }
  if (cmd === "fetch") {
    const limit = Number(arg("limit", Infinity)), jobs = Number(arg("jobs", 8))
    const seed = arg("seed", "20261123")
    // One snapshot per fix commit: several advisories often share a fix.
    const seen = new Set()
    const todo = filterCases(loadIndex()).sort((a, b) => key(seed, a).localeCompare(key(seed, b)))
      .filter((c) => !seen.has(c.source.fixed) && seen.add(c.source.fixed)).slice(0, limit).filter((c) => !hasSnapshot(c.id))
    const failed = join(CACHE, "failed.jsonl")
    console.log(`${todo.length} to fetch`)
    let done = 0, bad = 0
    const worker = async () => {
      for (let c; (c = todo.shift()); ) {
        // A child per case: one stuck fetch cannot block the pool.
        const ok = await new Promise((res) => {
          const p = spawn(process.execPath, [fileURLToPath(import.meta.url), "one", JSON.stringify(c)], { stdio: ["ignore", "ignore", "pipe"] })
          let err = ""
          p.stderr.on("data", (b) => (err += b))
          const t = setTimeout(() => p.kill("SIGKILL"), 900_000)
          p.on("close", (code) => { clearTimeout(t); if (code) writeFileSync(failed, JSON.stringify({ id: c.id, err: err.trim().slice(-300) }) + "\n", { flag: "a" }); res(code === 0) })
        })
        done++; if (!ok) bad++
        if (done % 20 === 0) console.log(`${done} done, ${bad} failed`)
      }
    }
    await Promise.all(Array.from({ length: jobs }, worker))
    console.log(`${done} done, ${bad} failed`)
    return
  }
  if (cmd === "one") { buildSnapshot(JSON.parse(process.argv[3])); return }
  if (cmd === "select") {
    const out = arg("out"), kind = arg("kind"), per = Number(arg("per", Infinity)), seed = arg("seed", "20261123")
    if (!out) throw new Error("--out required")
    const groups = new Map()
    for (const c of filterCases(loadIndex()).sort((a, b) => key(seed, a).localeCompare(key(seed, b)))) {
      const m = readMeta(c.id)
      if (!m || m.skip || (kind && m.kind !== kind)) continue
      const g = `${c.language}|${c.class}`
      const list = groups.get(g) ?? []
      if (list.length < per) list.push({ id: c.id, language: c.language, class: c.class, cwe: c.cwe, kind: m.kind, source: c.source })
      groups.set(g, list)
    }
    const cases = [...groups.values()].flat()
    writeFileSync(out, JSON.stringify(cases, null, 1) + "\n")
    console.log(`${cases.length} cases → ${out}`)
    return
  }
  if (cmd === "stats") {
    const metas = existsSync(META) ? readdirSync(META).map((f) => JSON.parse(readFileSync(join(META, f), "utf8"))) : []
    const rows = {}
    let bytes = 0
    for (const m of metas) {
      bytes += m.bytes
      const r = (rows[`${m.language}/${m.class}`] ??= { app: 0, lib: 0, skip: 0 })
      if (m.skip) r.skip++; else r[m.kind]++
    }
    console.log(`${metas.length} snapshots, ${(bytes / 1e9).toFixed(2)} GB`)
    for (const [k, r] of Object.entries(rows).sort()) console.log(`${k.padEnd(32)} app ${r.app}  lib ${r.lib}  skip ${r.skip}`)
    return
  }
  throw new Error("usage: case-cache.mjs index|fetch|select|stats")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
