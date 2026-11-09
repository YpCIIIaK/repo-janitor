#!/usr/bin/env node
/**
 * Keep benchmark data on GitHub instead of on the local disk, in small parts.
 *
 *   node benchmark/archive.mjs pack            pack .results (scans, OSV) + .history + .inventory into chunks of 100 repos,
 *                                              and .gitlog into separate gitlog-NNN chunks
 *   node benchmark/archive.mjs push            commit the chunks to the `bench-data` branch and push
 *   node benchmark/archive.mjs pull [repo…]    fetch `bench-data` and unpack only the chunks
 *                                              holding these repos (all chunks with no names)
 *
 * The clones themselves are not archived: every repo is pinned to a SHA in
 * corpus.json, so `run.mjs` re-clones whatever it needs. What is archived is
 * what took time to compute: scan results, full reports and git history
 * summaries. A manifest maps each repo to its chunk, so a single repo costs
 * one ~1–2 MB download, not the whole set.
 *
 * `bench-data` is an orphan branch holding nothing but the archives; it is
 * never merged into the code branches.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { gzipSync } from "node:zlib"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const archiveDir = join(here, ".archive")
const BRANCH = "bench-data"
const CHUNK = 100

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr}`)
  return r.stdout
}

/**
 * A byte-for-byte reproducible .tar.gz: sorted names, zero mtimes, no owner
 * names, and a gzip header without a timestamp (node's default). An unchanged
 * chunk then has the same blob on the data branch, so a push only adds the
 * chunks whose contents really changed and the branch history stays small.
 */
function deterministicTarGz(listFile, out, gzip = true) {
  const tar = spawnSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--mode=u+rw,go+r", "-cf", "-", "-C", here, "-T", listFile], { maxBuffer: 2 ** 31 })
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
  writeFileSync(out, gzip ? gzipSync(tar.stdout, { level: 9 }) : tar.stdout)
}

function pack() {
  rmSync(archiveDir, { recursive: true, force: true })
  mkdirSync(archiveDir, { recursive: true })
  const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
  const names = corpus.map((r) => r.name).sort()
  const manifest = { generatedAt: new Date().toISOString(), chunkSize: CHUNK, chunks: {} }
  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK)
    const id = `chunk-${String(i / CHUNK).padStart(3, "0")}`
    const files = []
    for (const n of part) {
      for (const f of [`.results/${n}.json`, `.results/${n}.report.json`, `.results/${n}.osv.json`, `.history/${n}.json`, `.inventory/${n}.json`]) {
        if (existsSync(join(here, f))) files.push(f)
      }
    }
    if (!files.length) continue
    writeFileSync(join(archiveDir, `${id}.list`), files.join("\n") + "\n")
    deterministicTarGz(join(archiveDir, `${id}.list`), join(archiveDir, `${id}.tar.gz`))
    rmSync(join(archiveDir, `${id}.list`))
    manifest.chunks[id] = part
  }
  // Raw git data (.gitlog, already gzipped per repo) in chunks of their own: it
  // changes only when a repo is added or re-pinned, so these chunks stay
  // byte-identical across most pushes and cost nothing to re-push.
  manifest.gitlog = {}
  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK)
    const id = `gitlog-${String(i / CHUNK).padStart(3, "0")}`
    const files = part.map((n) => `.gitlog/${n}.json.gz`).filter((f) => existsSync(join(here, f)))
    if (!files.length) continue
    writeFileSync(join(archiveDir, `${id}.list`), files.join("\n") + "\n")
    deterministicTarGz(join(archiveDir, `${id}.list`), join(archiveDir, `${id}.tar`), false)
    rmSync(join(archiveDir, `${id}.list`))
    manifest.gitlog[id] = part
  }
  // Labels and the confidence inputs are already in the code branch; the
  // corpus pins the exact commits these results belong to.
  writeFileSync(join(archiveDir, "corpus.json"), readFileSync(join(here, "corpus.json")))
  writeFileSync(join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n")
  const size = readdirSync(archiveDir).length
  console.log(`packed ${Object.keys(manifest.chunks).length} chunks (${size} files) into benchmark/.archive`)
}

function push() {
  if (!existsSync(join(archiveDir, "manifest.json"))) throw new Error("nothing packed — run `pack` first")
  const wt = join(here, ".archive-worktree")
  rmSync(wt, { recursive: true, force: true })
  sh("git", ["-C", root, "worktree", "prune"])
  const exists = spawnSync("git", ["-C", root, "ls-remote", "--exit-code", "--heads", "origin", BRANCH]).status === 0
  if (exists) {
    sh("git", ["-C", root, "fetch", "--quiet", "origin", BRANCH])
    sh("git", ["-C", root, "worktree", "add", "--quiet", "-B", BRANCH, wt, `origin/${BRANCH}`])
  } else {
    sh("git", ["-C", root, "worktree", "add", "--quiet", "--detach", wt])
    sh("git", ["-C", wt, "checkout", "--quiet", "--orphan", BRANCH])
    sh("git", ["-C", wt, "rm", "-rf", "--quiet", "."])
  }
  for (const f of readdirSync(wt)) if (f !== ".git") rmSync(join(wt, f), { recursive: true, force: true })
  for (const f of readdirSync(archiveDir)) writeFileSync(join(wt, f), readFileSync(join(archiveDir, f)))
  writeFileSync(
    join(wt, "README.md"),
    "# bench-data\n\nCompressed repo-janitor benchmark data (scan results, reports, git history summaries).\n" +
      "Not code: never merge this branch. Unpack with `node benchmark/archive.mjs pull [repo…]` from the main branch.\n",
  )
  sh("git", ["-C", wt, "add", "-A"])
  const changed = spawnSync("git", ["-C", wt, "diff", "--cached", "--quiet"]).status !== 0
  if (changed) {
    sh("git", ["-C", wt, "commit", "--quiet", "-m", `bench-data: ${new Date().toISOString().slice(0, 10)} snapshot`])
    sh("git", ["-C", wt, "push", "--quiet", "-u", "origin", BRANCH])
    console.log(`pushed to ${BRANCH}`)
  } else console.log("bench-data already up to date")
  sh("git", ["-C", root, "worktree", "remove", "--force", wt])
}

function pull(wanted) {
  sh("git", ["-C", root, "fetch", "--quiet", "origin", BRANCH])
  const show = (f) => spawnSync("git", ["-C", root, "show", `origin/${BRANCH}:${f}`], { maxBuffer: 1 << 30 })
  const manifest = JSON.parse(show("manifest.json").stdout.toString())
  const ids = Object.entries(manifest.chunks)
    .filter(([, repos]) => !wanted.length || repos.some((r) => wanted.includes(r)))
    .map(([id]) => id)
  if (!ids.length) throw new Error(`no chunk holds ${wanted.join(", ")}`)
  for (const id of ids) {
    const tgz = show(`${id}.tar.gz`).stdout
    const tmp = join(here, `.${id}.tar.gz`)
    writeFileSync(tmp, tgz)
    sh("tar", ["-xzf", tmp, "-C", here])
    rmSync(tmp)
  }
  const logIds = Object.entries(manifest.gitlog ?? {})
    .filter(([, repos]) => !wanted.length || repos.some((r) => wanted.includes(r)))
    .map(([id]) => id)
  for (const id of logIds) {
    const tmp = join(here, `.${id}.tar`)
    writeFileSync(tmp, show(`${id}.tar`).stdout)
    sh("tar", ["-xf", tmp, "-C", here])
    rmSync(tmp)
  }
  console.log(`unpacked ${ids.length} chunk(s)${logIds.length ? ` and ${logIds.length} git-log chunk(s)` : ""}: ${ids.join(", ")}`)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "pack") pack()
else if (cmd === "push") push()
else if (cmd === "pull") pull(rest)
else {
  console.error("usage: archive.mjs pack | push | pull [repo…]")
  process.exit(1)
}
