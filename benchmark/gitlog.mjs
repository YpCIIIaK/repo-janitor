#!/usr/bin/env node
/**
 * Build .gitlog/<repo>.json.gz (see collectGitData in history.mjs) for every
 * corpus repo that lacks it, from blob-less bare clones: commits and trees
 * only, plus the few workflow and Dockerfile blobs fetched on demand.
 *
 *   node benchmark/gitlog.mjs [repo…]
 */
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { collectGitData, loadGitData, saveGitData } from "./history.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const work = join(here, ".gitlogcache")
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const only = process.argv.slice(2)

function sh(args) {
  return new Promise((resolve) => {
    const p = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    p.stderr.on("data", (d) => (err += d))
    p.on("error", (e) => resolve({ status: -1, err: e.message }))
    p.on("close", (status) => resolve({ status, err }))
  })
}

async function one(repo) {
  const dir = join(work, repo.name)
  rmSync(dir, { recursive: true, force: true })
  try {
    let c
    for (let attempt = 0; attempt < 3; attempt++) {
      c = await sh(["clone", "--quiet", "--bare", "--filter=blob:none", repo.url, dir])
      if (c.status === 0) break
      rmSync(dir, { recursive: true, force: true })
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
    }
    if (c.status !== 0) throw new Error(`clone failed: ${c.err.trim().split("\n").pop()}`)
    if ((await sh(["-C", dir, "cat-file", "-e", `${repo.sha}^{commit}`])).status !== 0) {
      await sh(["-C", dir, "fetch", "--quiet", "--filter=blob:none", "origin", repo.sha])
    }
    const data = await collectGitData(dir, repo.sha)
    if (!data.tree.length) throw new Error("pinned commit not found")
    saveGitData(repo.name, data)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

mkdirSync(work, { recursive: true })
const queue = corpus.filter((r) => (!only.length || only.includes(r.name)) && !loadGitData(r.name, r.sha))
console.log(`${queue.length} git logs to collect`)
let failures = 0
let done = 0
await Promise.all(
  Array.from({ length: Number(process.env.BENCH_JOBS ?? availableParallelism() * 2) }, async () => {
    while (queue.length) {
      const r = queue.shift()
      try {
        await one(r)
        if (++done % 200 === 0) console.log(`${done} done`)
      } catch (e) {
        failures++
        console.error(`${r.name}: ${e.message}`)
      }
    }
  }),
)
console.log(failures ? `${failures} failed; rerun to retry` : "all git logs collected")
