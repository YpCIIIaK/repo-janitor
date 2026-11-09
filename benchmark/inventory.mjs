#!/usr/bin/env node
/**
 * File inventory of each corpus repo at its pinned commit: counts by file
 * extension, counts of notable file names (manifests, lockfiles, Dockerfiles,
 * dotfiles…), and of a few directories. Lets a partial rescan skip repos
 * where a scanner cannot find anything (see scanner-inputs.mjs).
 *
 *   node benchmark/inventory.mjs [repo…]   missing inventories, via blob-less clones
 *   node benchmark/inventory.mjs --check   verify scanner-inputs.mjs against all findings
 *
 * run.mjs also writes the inventory whenever it has a full clone.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { mayProduce } from "./scanner-inputs.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const invDir = join(here, ".inventory")
const work = join(here, ".invcache")

const NOTABLE = /^(dockerfile.*|.+\.dockerfile|docker-compose.*|compose\.ya?ml|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|poetry\.lock|uv\.lock|pipfile(\.lock)?|requirements.*\.txt|go\.(mod|sum)|cargo\.(toml|lock)|gemfile(\.lock)?|composer\.(json|lock)|chart\.yaml|action\.ya?ml|\..+|[^.]+)$/
const DIRS = [".github/workflows/", ".circleci/", ".devcontainer/", "node_modules/", "vendor/"]

/** Build an inventory from a list of paths (one per line, as `git ls-tree -r --name-only` prints). */
export function inventoryOf(paths, sha) {
  const exts = {}
  const names = {}
  const dirs = {}
  for (const p of paths) {
    if (!p) continue
    const base = p.slice(p.lastIndexOf("/") + 1).toLowerCase()
    const dot = base.lastIndexOf(".")
    const ext = dot > 0 ? base.slice(dot + 1) : ""
    if (ext) exts[ext] = (exts[ext] ?? 0) + 1
    if (NOTABLE.test(base)) names[base] = (names[base] ?? 0) + 1
    for (const d of DIRS) if (p.startsWith(d) || p.includes(`/${d}`)) dirs[d] = (dirs[d] ?? 0) + 1
  }
  return { sha, files: paths.filter(Boolean).length, exts, names, paths: dirs }
}

export function writeInventory(name, paths, sha) {
  mkdirSync(invDir, { recursive: true })
  writeFileSync(join(invDir, `${name}.json`), JSON.stringify(inventoryOf(paths, sha)))
}

export function readInventory(name, sha) {
  const p = join(invDir, `${name}.json`)
  if (!existsSync(p)) return null
  try {
    const inv = JSON.parse(readFileSync(p, "utf8"))
    return inv.sha === sha ? inv : null
  } catch {
    return null
  }
}

function sh(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    p.stdout.on("data", (d) => (out += d))
    p.stderr.on("data", (d) => (err += d))
    p.on("error", (e) => resolve({ status: -1, out, err: e.message }))
    p.on("close", (status) => resolve({ status, out, err }))
  })
}

async function fetchOne(repo) {
  const dir = join(work, repo.name)
  rmSync(dir, { recursive: true, force: true })
  try {
    let c
    for (let attempt = 0; attempt < 3; attempt++) {
      c = await sh("git", ["clone", "--quiet", "--bare", "--filter=blob:none", repo.url, dir])
      if (c.status === 0) break
      rmSync(dir, { recursive: true, force: true })
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
    }
    if (c.status !== 0) throw new Error(`clone failed: ${c.err.trim().split("\n").pop()}`)
    let ls = await sh("git", ["-C", dir, "ls-tree", "-r", "--name-only", repo.sha])
    if (ls.status !== 0) {
      await sh("git", ["-C", dir, "fetch", "--quiet", "--filter=blob:none", "origin", repo.sha])
      ls = await sh("git", ["-C", dir, "ls-tree", "-r", "--name-only", repo.sha])
      if (ls.status !== 0) throw new Error("pinned commit not found")
    }
    writeInventory(repo.name, ls.out.split("\n"), repo.sha)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
  const args = process.argv.slice(2)

  if (args.includes("--check")) {
    // Every finding a scanner produced must come from a repo whose inventory
    // says that scanner may produce something. A violation means the declared
    // inputs are too narrow and a partial rescan could miss findings.
    let checked = 0
    const missing = []
    const violations = new Map()
    for (const r of corpus) {
      const inv = readInventory(r.name, r.sha)
      const res = join(here, ".results", `${r.name}.json`)
      if (!inv) { missing.push(r.name); continue }
      if (!existsSync(res)) continue
      checked++
      for (const id of new Set(JSON.parse(readFileSync(res, "utf8")).findings.map((f) => f.scanner))) {
        if (!mayProduce(id, inv)) violations.set(id, [...(violations.get(id) ?? []), r.name])
      }
    }
    console.log(`checked ${checked} repos; ${missing.length} without inventory`)
    for (const [id, repos] of violations) console.log(`TOO NARROW ${id}: ${repos.length} repos, e.g. ${repos.slice(0, 3).join(", ")}`)
    if (!violations.size) console.log("scanner-inputs.mjs covers every finding")
    process.exitCode = violations.size ? 1 : 0
    return
  }

  const only = args.filter((a) => !a.startsWith("--"))
  const queue = corpus.filter((r) => (!only.length || only.includes(r.name)) && !readInventory(r.name, r.sha))
  console.log(`${queue.length} inventories to build`)
  mkdirSync(work, { recursive: true })
  let failures = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Number(process.env.BENCH_JOBS ?? availableParallelism() * 2) }, async () => {
      while (queue.length) {
        const r = queue.shift()
        try {
          await fetchOne(r)
          if (++done % 200 === 0) console.log(`${done} done`)
        } catch (e) {
          failures++
          console.error(`${r.name}: ${e.message}`)
        }
      }
    }),
  )
  console.log(failures ? `${failures} failed; rerun to retry` : "all inventories built")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
