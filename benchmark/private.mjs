#!/usr/bin/env node
/**
 * Sync benchmark data with the private data repo.
 *
 *   node benchmark/private.mjs pull   clone/update the data repo and copy its files into this checkout
 *   node benchmark/private.mjs push   copy this checkout's data files back and push them
 *
 * The data repo lives next to this one (../repo-janitor-data, or BENCH_PRIVATE_DIR).
 * Paths are listed in benchmark/private-paths.txt and ignored by the public repo.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
export const DATA_REMOTE = process.env.BENCH_DATA_REMOTE || "https://github.com/YpCIIIaK/repo-janitor-data"
const dir = resolve(process.env.BENCH_PRIVATE_DIR || join(root, "..", "repo-janitor-data"))

export const privatePaths = () =>
  readFileSync(join(here, "private-paths.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`)
}

/** Expand "CYCLE-*.md"-style entries against a base directory. */
function expand(base, p) {
  if (!p.includes("*")) return existsSync(join(base, p)) ? [p.replace(/\/$/, "")] : []
  const d = dirname(p)
  const re = new RegExp("^" + p.slice(d.length + 1).replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$")
  return existsSync(join(base, d)) ? readdirSync(join(base, d)).filter((f) => re.test(f)).map((f) => join(d, f)) : []
}

function copy(from, to) {
  for (const p of privatePaths())
    for (const rel of expand(from, p)) {
      rmSync(join(to, rel), { recursive: true, force: true })
      cpSync(join(from, rel), join(to, rel), { recursive: true })
    }
}

const cmd = process.argv[2]
if (cmd === "pull") {
  if (existsSync(join(dir, ".git"))) sh("git", ["-C", dir, "pull", "--ff-only", "--quiet", "origin", "main"])
  else sh("git", ["clone", "--quiet", "--depth", "1", "--branch", "main", DATA_REMOTE, dir])
  copy(dir, root)
  console.log(`data copied from ${dir}`)
} else if (cmd === "push") {
  if (!existsSync(join(dir, ".git"))) throw new Error(`run "pull" first: ${dir} is not a checkout`)
  copy(root, dir)
  sh("git", ["-C", dir, "add", "-A"])
  if (spawnSync("git", ["-C", dir, "diff", "--cached", "--quiet"]).status === 0) console.log("data repo already up to date")
  else {
    sh("git", ["-C", dir, "commit", "--quiet", "-m", process.argv[3] || `data: ${new Date().toISOString().slice(0, 10)}`])
    sh("git", ["-C", dir, "push", "--quiet", "origin", "HEAD:main"])
    console.log("pushed data repo")
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("usage: node benchmark/private.mjs pull|push [message]")
  process.exit(1)
}
