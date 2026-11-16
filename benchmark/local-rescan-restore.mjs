import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const FOLDERS = [".results", ".history", ".inventory", ".gitlog"]
export function validateArchivePaths(paths) {
  for (const path of paths) {
    if (!/^(?:\.results|\.history|\.inventory|\.gitlog)\/(?:[a-z0-9][a-z0-9._-]*\.json(?:\.gz)?)?$/i.test(path)) throw new Error(`Unexpected archive path: ${path}`)
  }
}
export function installBaseline(staging, baseline) {
  let files = 0
  for (const folder of FOLDERS) {
    if (!existsSync(join(staging, folder))) continue
    mkdirSync(join(baseline, folder), { recursive: true })
    for (const entry of readdirSync(join(staging, folder), { withFileTypes: true })) {
      validateArchivePaths([`${folder}/${entry.name}`])
      if (!entry.isFile()) throw new Error("Baseline archives must contain regular files only")
      const destination = join(baseline, folder, entry.name)
      if (!existsSync(destination)) { cpSync(join(staging, folder, entry.name), destination); files++ }
    }
  }
  return files
}

/** Restore the verified public dataset to a separate baseline, never .results. */
function restoreSnapshot(root, ref) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,199}$/.test(ref)) throw new Error("Invalid data ref")
  const run = (cmd, args, options = {}) => {
    const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 4_000_000, ...options })
    if (result.error || result.status !== 0) throw new Error(`${cmd} failed; Git and tar must be installed and origin must be reachable`)
    return result.stdout
  }
  const git = args => run("git", ["-C", root, ...args])
  git(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", ref])
  const commit = git(["rev-parse", "FETCH_HEAD"]).trim()
  const manifest = JSON.parse(git(["show", `${commit}:manifest.json`]))
  const checksums = new Map(git(["show", `${commit}:checksums.sha256`]).trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)
    if (!match) throw new Error("Invalid SHA-256 manifest")
    return [match[2], match[1]]
  }))
  const store = join(root, "benchmark", ".local-rescans"), baseline = join(store, "baseline")
  mkdirSync(baseline, { recursive: true })
  const marker = join(baseline, "snapshot.json")
  if (existsSync(marker) && JSON.parse(readFileSync(marker, "utf8")).commit !== commit) throw new Error("Another baseline is already installed; preserve or move it before restoring another snapshot")
  writeFileSync(marker, JSON.stringify({ commit, ref, status: "restoring" }))
  const temporary = join(store, `restore-${randomUUID()}`)
  mkdirSync(temporary)
  let installed = 0
  const archives = [...Object.keys(manifest.chunks ?? {}).map(id => `${id}.tar.gz`), ...Object.keys(manifest.gitlog ?? {}).map(id => `${id}.tar`)]
  if (!archives.length) throw new Error("Empty data manifest")
  try {
    for (const [index, archive] of archives.entries()) {
      if (!/^(?:chunk|gitlog)-\d+\.tar(?:\.gz)?$/.test(archive) || !checksums.has(archive)) throw new Error("Archive is missing from the SHA-256 manifest")
      const file = join(temporary, archive), fd = openSync(file, "w", 0o600)
      try { run("git", ["-C", root, "show", `${commit}:${archive}`], { stdio: ["ignore", fd, "pipe"] }) } finally { closeSync(fd) }
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== checksums.get(archive)) throw new Error(`Checksum mismatch: ${archive}`)
      validateArchivePaths(run("tar", ["-tf", file]).trim().split(/\r?\n/))
      const staging = join(temporary, "unpacked")
      mkdirSync(staging)
      run("tar", ["-xf", file, "-C", staging])
      installed += installBaseline(staging, baseline)
      rmSync(staging, { recursive: true }); rmSync(file)
      console.log(`${index + 1}/${archives.length} archives restored`)
    }
    writeFileSync(marker, JSON.stringify({ commit, ref, status: "complete", restoredAt: new Date().toISOString() }))
  } finally { rmSync(temporary, { recursive: true }) }
  return { baseline, commit, installed }
}

export function restoreBaseline(root, ref = "bench-data-2026-11-15-1") {
  const store = join(root, "benchmark", ".local-rescans"), lock = join(store, "active.lock")
  mkdirSync(store, { recursive: true })
  if (existsSync(lock)) {
    const owner = JSON.parse(readFileSync(lock, "utf8"))
    let running = true
    try { process.kill(owner.pid, 0) } catch { running = false }
    if (running) throw new Error("Pause or stop the active rescan before restoring a baseline")
    rmSync(lock)
  }
  let fd
  try { fd = openSync(lock, "wx", 0o600) } catch { throw new Error("Another local operation is active") }
  writeFileSync(fd, JSON.stringify({ id: "baseline-restore", pid: process.pid })); closeSync(fd)
  try { return restoreSnapshot(root, ref) }
  finally { rmSync(lock) }
}
