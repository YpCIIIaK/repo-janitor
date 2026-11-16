import { spawn, spawnSync } from "node:child_process"
import { randomUUID, createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cpSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { setInterval, clearInterval, clearTimeout } from "node:timers"

const NAME = /^[a-z0-9][a-z0-9._-]{0,199}$/
const ID = /^[a-f0-9-]{36}$/
const ACTIVE = new Set(["preparing", "running", "pausing", "stopping"])
class DiskReserveError extends Error {}
const read = (path, fallback = null) => { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return fallback } }
const now = () => new Date().toISOString()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function atomic(path, value) {
  const pending = `${path}.${process.pid}.pending`
  writeFileSync(pending, JSON.stringify(value), { mode: 0o600 })
  renameSync(pending, path)
}
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
export const storePath = root => join(root, "benchmark", ".local-rescans")
const baselineFile = (root, folder, file, previous = null) => {
  const local = previous && join(previous, folder, file)
  if (local && existsSync(local)) return local
  const original = join(root, "benchmark", folder, file)
  return existsSync(original) ? original : join(storePath(root), "baseline", folder, file)
}
export function runPath(root, id) {
  if (!ID.test(id)) throw new Error("Invalid run id")
  return join(storePath(root), id)
}

export function pinnedTargets(input) {
  if (!Array.isArray(input) || !input.length || input.length > 50_000) throw new Error("Choose 1..50000 pinned repositories")
  const names = new Set()
  return input.map(row => {
    const url = String(row?.url ?? "").replace(/\.git$/, "")
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(url)
    if (!match || !/^[a-f0-9]{40}$/i.test(row?.sha ?? "")) throw new Error("Every target needs a public GitHub URL and a full 40-character commit SHA")
    const name = row.name ?? `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-")
    if (typeof name !== "string" || !NAME.test(name) || names.has(name)) throw new Error(`Invalid or duplicate repository name: ${name}`)
    names.add(name)
    return { name, url, sha: row.sha.toLowerCase() }
  })
}

export async function scannerIds(root) {
  const module = await import(/* webpackIgnore: true */ pathToFileURL(join(root, "benchmark", "fingerprint.mjs")).href)
  return Object.keys(module.scannerModules()).sort()
}

export async function catalog(root) {
  const corpus = pinnedTargets(read(join(root, "benchmark", "corpus.json"), []))
  return {
    scanners: await scannerIds(root),
    // Runtime-only local files must never be traced into the deployed site.
    repos: corpus.map(repo => ({ ...repo, scanned: existsSync(/* turbopackIgnore: true */ baselineFile(root, ".results", `${repo.name}.json`)) })),
    baselineRecords: corpus.filter(repo => existsSync(/* turbopackIgnore: true */ baselineFile(root, ".results", `${repo.name}.json`))).length,
  }
}

export async function createRun(root, input) {
  const baseline = read(join(storePath(root), "baseline", "snapshot.json"))
  if (baseline?.status === "restoring") throw new Error("Finish restoring the baseline first: pnpm local:rescan restore")
  const known = await scannerIds(root)
  const config = {
    mode: input.mode ?? "changed", jobs: input.jobs ?? 4, minFreeGiB: input.minFreeGiB ?? 2,
    timeoutMinutes: input.timeoutMinutes ?? 30, refreshMetadata: input.refreshMetadata === true,
    scanners: [...new Set(input.scanners ?? [])], baselineRun: input.baselineRun ?? null,
  }
  if (config.baselineRun && getRun(root, config.baselineRun).status !== "completed") throw new Error("Baseline run must be fully completed")
  if (!["changed", "full", "scanners"].includes(config.mode)) throw new Error("Mode must be changed, full or scanners")
  if (!Number.isInteger(config.jobs) || config.jobs < 1 || config.jobs > 32) throw new Error("Workers must be 1..32")
  if (!Number.isFinite(config.minFreeGiB) || config.minFreeGiB < 0 || config.minFreeGiB > 1024) throw new Error("Minimum free space must be 0..1024 GiB")
  if (!Number.isInteger(config.timeoutMinutes) || config.timeoutMinutes < 1 || config.timeoutMinutes > 180) throw new Error("Timeout must be 1..180 minutes")
  if (!Array.isArray(input.scanners ?? []) || config.scanners.some(id => !known.includes(id))) throw new Error("Unknown scanner")
  if (config.mode === "scanners" && !config.scanners.length) throw new Error("Choose at least one scanner")
  if (config.mode === "scanners" && config.scanners.some(id => ["vulnerable-deps", "license-risk"].includes(id)) && !config.refreshMetadata) throw new Error("Enable metadata refresh for network scanners")
  const corpus = pinnedTargets(read(join(root, "benchmark", "corpus.json"), []))
  let repos
  if (input.targets) repos = pinnedTargets(input.targets)
  else if (input.names) {
    if (!Array.isArray(input.names) || !input.names.length) throw new Error("Choose repositories")
    const names = new Set(input.names)
    repos = corpus.filter(repo => names.has(repo.name))
    if (repos.length !== names.size) throw new Error("Selection contains unknown repositories")
  } else repos = corpus
  repos = pinnedTargets(repos)
  const canonical = new Map(corpus.map(repo => [repo.name, repo.url.toLowerCase()]))
  if (repos.some(repo => canonical.has(repo.name) && canonical.get(repo.name) !== repo.url.toLowerCase())) throw new Error("A repository name is already used by another URL; choose a unique name")
  for (const file of ["packages/cli/dist/index.js", "packages/core/dist/index.js"]) {
    if (!existsSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, file))) throw new Error("Build the scanner first: pnpm run build:packages")
  }
  const id = randomUUID(), directory = runPath(root, id)
  mkdirSync(join(directory, "tasks"), { recursive: true })
  mkdirSync(join(directory, "logs"))
  atomic(join(directory, "plan.json"), { id, createdAt: now(), config, repos })
  atomic(join(directory, "state.json"), {
    id, status: "queued", createdAt: now(), updatedAt: now(), config,
    total: repos.length, done: 0, failed: 0, pending: repos.length, active: [], recent: [], errors: [],
    resultsPath: join(directory, "workspace", "benchmark", ".results"),
  })
  return id
}

export function getRun(root, id) {
  const state = read(join(runPath(root, id), "state.json"))
  if (!state) throw new Error("Run not found")
  if (ACTIVE.has(state.status) && state.pid && !alive(state.pid)) return { ...state, status: "interrupted", active: [] }
  if (ACTIVE.has(state.status)) {
    const action = read(join(runPath(root, id), "control.json"), {}).action
    if (action === "pause") return { ...state, status: "pausing" }
    if (action === "cancel") return { ...state, status: "stopping" }
  }
  return state
}
export function listRuns(root) {
  if (!existsSync(storePath(root))) return []
  return readdirSync(storePath(root)).filter(id => ID.test(id)).map(id => getRun(root, id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
}
export function controlRun(root, id, action) {
  if (!["pause", "cancel", "resume", "retry"].includes(action)) throw new Error("Unknown action")
  getRun(root, id)
  atomic(join(runPath(root, id), "control.json"), { action, requestedAt: now() })
}
export function launchRun(root, id) {
  const state = getRun(root, id)
  if (ACTIVE.has(state.status)) return
  const lease = read(join(storePath(root), "active.lock"))
  if (lease && alive(lease.pid)) {
    atomic(join(runPath(root, id), "state.json"), { ...state, status: "failed", error: "Another local rescan is active", updatedAt: now() })
    throw new Error("Another local rescan is active")
  }
  const child = spawn(process.execPath, [join(root, "benchmark", "local-rescan.mjs"), "worker", id], {
    cwd: root, detached: true, stdio: "ignore", windowsHide: true,
  })
  child.on("error", error => {
    atomic(join(runPath(root, id), "state.json"), { ...state, status: "failed", error: error.message, updatedAt: now() })
  })
  atomic(join(runPath(root, id), "state.json"), { ...state, status: "preparing", pid: child.pid, updatedAt: now() })
  child.unref()
}

export function taskDetail(root, id, name) {
  if (!NAME.test(name)) throw new Error("Invalid repository name")
  const directory = runPath(root, id), plan = read(join(directory, "plan.json"))
  if (!plan?.repos.some(repo => repo.name === name)) throw new Error("Repository is not in this run")
  const path = join(directory, "logs", `${name}.log`)
  const log = existsSync(path) ? readFileSync(path, "utf8").slice(-16_000) : ""
  return { task: read(join(directory, "tasks", `${name}.json`), { name, status: "pending" }), log }
}
export function taskReport(root, id, name, metadata = false) {
  taskDetail(root, id, name)
  const task = read(join(runPath(root, id), "tasks", `${name}.json`))
  if (task?.status !== "done") throw new Error("Result is not complete")
  const report = read(join(runPath(root, id), "workspace", "benchmark", ".results", `${name}.${metadata ? "osv" : "report"}.json`))
  if (!report) throw new Error("Report not found")
  return report
}

function linkDependencies(source, target) {
  if (existsSync(source) && !existsSync(target)) symlinkSync(resolve(source), target, process.platform === "win32" ? "junction" : "dir")
}
export async function prepareWorkspace(root, id) {
  const directory = runPath(root, id), workspace = join(directory, "workspace")
  const plan = read(join(directory, "plan.json"))
  if (existsSync(join(workspace, "ready.json"))) return workspace
  // An interrupted preparation is never reused as a frozen build.
  if (existsSync(workspace)) rmSync(workspace, { recursive: true })
  mkdirSync(join(workspace, "benchmark"), { recursive: true })
  for (const entry of readdirSync(join(root, "benchmark"))) {
    if (entry.endsWith(".mjs")) cpSync(join(root, "benchmark", entry), join(workspace, "benchmark", entry), { preserveTimestamps: true })
  }
  for (const file of ["package.json", "pnpm-lock.yaml"]) {
    if (existsSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, file))) cpSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, file), /* turbopackIgnore: true */ join(workspace, file), { preserveTimestamps: true })
  }
  for (const pkg of ["core", "cli"]) {
    const target = join(workspace, "packages", pkg)
    mkdirSync(target, { recursive: true })
    for (const entry of ["src", "dist", "package.json"]) cpSync(join(root, "packages", pkg, entry), join(target, entry), { recursive: true, preserveTimestamps: true })
    linkDependencies(join(root, "packages", pkg, "node_modules"), join(target, "node_modules"))
  }
  linkDependencies(join(root, "node_modules"), join(workspace, "node_modules"))
  atomic(join(workspace, "benchmark", "corpus.json"), plan.repos)
  const previousPlan = plan.config.baselineRun ? read(join(runPath(root, plan.config.baselineRun), "plan.json")) : null
  const previousRepos = new Map((previousPlan?.repos ?? []).map(repo => [repo.name, repo]))
  for (const folder of [".results", ".inventory", ".history", ".gitlog", "labels"]) {
    mkdirSync(join(workspace, "benchmark", folder))
    for (const repo of plan.repos) {
      if (read(join(directory, "control.json"), {}).action === "cancel") throw new Error("Stopped by user")
      const match = previousRepos.get(repo.name)
      const previous = match?.url.toLowerCase() === repo.url.toLowerCase() && match?.sha === repo.sha
        ? join(runPath(root, plan.config.baselineRun), "workspace", "benchmark") : null
      for (const suffix of folder === ".results" ? [".json", ".report.json", ".osv.json"] : folder === ".gitlog" ? [".json.gz"] : [".json"]) {
        const source = baselineFile(root, folder, `${repo.name}${suffix}`, previous)
        if (existsSync(source)) {
          if (availableGiB(directory) - statSync(source).size / 1024 ** 3 < plan.config.minFreeGiB) throw new DiskReserveError("Not enough disk space to copy the baseline with the configured reserve")
          cpSync(source, join(workspace, "benchmark", folder, `${repo.name}${suffix}`), { preserveTimestamps: true })
        }
      }
    }
  }
  const fp = await import(/* webpackIgnore: true */ pathToFileURL(join(workspace, "benchmark", "fingerprint.mjs")).href)
  const calibration = join(workspace, "packages/core/src/confidence-data.ts")
  const newestInput = Math.max(fp.newestSource(), existsSync(calibration) ? statSync(calibration).mtimeMs : 0)
  for (const file of ["packages/core/dist/index.js", "packages/cli/dist/index.js"]) {
    if (statSync(join(workspace, file)).mtimeMs < newestInput) throw new Error("Build is stale: run pnpm run build:packages before creating a run")
  }
  atomic(join(workspace, "ready.json"), {
    fingerprint: fp.scanFingerprint(), scanners: fp.scannerFingerprints(), frozenAt: now(),
    confidenceSHA256: existsSync(calibration) ? createHash("sha256").update(readFileSync(calibration)).digest("hex") : null,
  })
  return workspace
}

function killTree(child, signal = "SIGTERM") {
  if (!child.pid) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }).on("error", () => {})
  } else {
    try { process.kill(-child.pid, signal) } catch { /* Already finished. */ }
  }
}
export function availableGiB(path) {
  const { bavail, bsize } = statfsSync(path)
  return bavail * bsize / 1024 ** 3
}

/** One lease per local installation; each task is its own process group. */
export async function worker(root, id) {
  const directory = runPath(root, id), lock = join(storePath(root), "active.lock")
  const plan = read(join(directory, "plan.json"))
  if (!plan) throw new Error("Run not found")
  const previousLock = read(lock)
  if (previousLock && !alive(previousLock.pid)) rmSync(lock)
  let fd
  try { fd = openSync(lock, "wx", 0o600) } catch {
    if (read(lock)?.id !== id) atomic(join(directory, "state.json"), { ...getRun(root, id), status: "failed", error: "Another local rescan is active", updatedAt: now() })
    throw new Error("Another local rescan is active")
  }
  writeFileSync(fd, JSON.stringify({ id, pid: process.pid }))
  closeSync(fd)
  const state = { ...getRun(root, id), pid: process.pid, status: "preparing", error: null }
  const tasks = new Map(plan.repos.map(repo => [repo.name, read(join(directory, "tasks", `${repo.name}.json`), { name: repo.name, status: "pending", attempts: 0 })]))
  const children = new Set()
  const previousActiveMs = state.activeMs ?? 0
  let runningSince = null
  let interrupted = false, diskBlocked = false
  const onSignal = () => { interrupted = true; for (const child of children) killTree(child) }
  process.on("SIGTERM", onSignal)
  process.on("SIGINT", onSignal)
  const saveTask = task => { tasks.set(task.name, task); atomic(join(directory, "tasks", `${task.name}.json`), task) }
  const publish = () => {
    const rows = [...tasks.values()]
    state.done = rows.filter(t => t.status === "done").length
    state.failed = rows.filter(t => t.status === "failed").length
    state.active = rows.filter(t => t.status === "running")
    state.pending = rows.length - state.done - state.failed - state.active.length
    state.recent = rows.filter(t => t.finishedAt).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 30)
    state.errors = rows.filter(t => t.status === "failed").slice(-50)
    state.updatedAt = now()
    state.activeMs = previousActiveMs + (runningSince === null ? 0 : Date.now() - runningSince)
    state.freeGiB = Math.round(availableGiB(directory) * 10) / 10
    atomic(join(directory, "state.json"), state)
  }
  const control = () => read(join(directory, "control.json"), {}).action
  const execute = (workspace, script, repo) => new Promise((resolveTask, reject) => {
    const env = { ...process.env, BENCH_JOBS: "1", BENCH_DROP_CLONES: "1", BENCH_FULL: plan.config.mode === "full" ? "1" : "0", BENCH_FORCE_SCANNERS: plan.config.mode === "scanners" ? plan.config.scanners.join(",") : "" }
    delete env.BENCH_MAX_MB // Keep the benchmark's standard 2000 MB limit.
    delete env.REPO_ANTI_ROT_OFFLINE
    const child = spawn(process.execPath, [join(workspace, "benchmark", script), repo.name], {
      cwd: workspace, env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    })
    children.add(child)
    const log = join(directory, "logs", `${repo.name}.log`)
    let bytes = 0, reason = "", settled = false
    const append = data => { if (bytes < 1_000_000) { appendFileSync(log, data); bytes += data.length } }
    child.stdout.on("data", append); child.stderr.on("data", append)
    const timer = setInterval(() => {
      if (control() === "cancel" || interrupted) reason = "Stopped by user"
      else if (Date.now() - started > plan.config.timeoutMinutes * 60_000) reason = "Repository timeout"
      else if (availableGiB(directory) < plan.config.minFreeGiB) { reason = "Free disk space below configured minimum"; diskBlocked = true }
      if (reason) { killTree(child); escalation ??= setTimeout(() => killTree(child, "SIGKILL"), 5_000) }
    }, 1_000)
    const started = Date.now()
    let escalation
    const finish = (error = null) => {
      if (settled) return
      settled = true; clearInterval(timer); if (escalation) clearTimeout(escalation)
      if (error) killTree(child, "SIGKILL")
      children.delete(child)
      if (error) reject(error); else resolveTask()
    }
    child.on("error", error => finish(error))
    child.on("close", code => finish(reason || code !== 0 ? new Error(reason || `Scanner exited ${code}; see repository log`) : null))
  })
  try {
    publish()
    const initial = control()
    for (const task of tasks.values()) {
      if (task.status === "running" || task.status === "cancelled" || initial === "retry" && task.status === "failed") saveTask({ ...task, status: "pending" })
    }
    if (initial === "resume" || initial === "retry") rmSync(join(directory, "control.json"))
    const workspace = await prepareWorkspace(root, id)
    state.fingerprint = read(join(workspace, "ready.json")).fingerprint
    state.status = "running"; state.startedAt ??= now(); runningSince = Date.now(); publish()
    const queue = plan.repos.filter(repo => tasks.get(repo.name).status === "pending")
    await Promise.all(Array.from({ length: plan.config.jobs }, async () => {
      while (queue.length && !interrupted && !diskBlocked && !["pause", "cancel"].includes(control())) {
        if (availableGiB(directory) < plan.config.minFreeGiB) { diskBlocked = true; break }
        const repo = queue.shift(), old = tasks.get(repo.name)
        const task = { name: repo.name, status: "running", attempts: old.attempts + 1, startedAt: now() }
        saveTask(task); publish()
        try {
          const resultPath = join(workspace, "benchmark", ".results", `${repo.name}.json`)
          const previous = read(resultPath)
          await execute(workspace, "run.mjs", repo)
          if (plan.config.refreshMetadata) {
            const metadata = join(workspace, "benchmark", ".results", `${repo.name}.osv.json`)
            if (existsSync(metadata)) rmSync(metadata)
            await execute(workspace, "osv.mjs", repo)
            const freshMetadata = read(metadata)
            if (freshMetadata?.sha !== repo.sha || freshMetadata.networkAudit?.version !== 2 || freshMetadata.networkAudit?.transportOK !== true) throw new Error("Missing or unsuccessful metadata audit")
          }
          const result = read(resultPath)
          const report = read(join(workspace, "benchmark", ".results", `${repo.name}.report.json`))
          if (result?.sha !== repo.sha || !Array.isArray(result?.findings) || !report || report.diagnostics?.failedScanners?.length) throw new Error("Missing or incomplete pinned result")
          const frozen = read(join(workspace, "ready.json")).scanners
          const expected = plan.config.mode === "scanners" ? plan.config.scanners : Object.keys(frozen.scanners)
          if (result.base !== frozen.base || expected.some(key => result.scanners?.[key] !== frozen.scanners[key])) throw new Error("Result has stale scanner fingerprints")
          // The legacy forced runner stamps every scanner. For a selective run
          // retain untouched versions so later incremental jobs cannot skip them.
          if (plan.config.mode === "scanners" && Array.isArray(result.rerun) && previous?.sha === repo.sha) {
            atomic(resultPath, {
              ...result, fingerprint: previous.fingerprint, base: previous.base ?? "unknown",
              scanners: { ...previous.scanners, ...Object.fromEntries(expected.map(key => [key, frozen.scanners[key]])) },
              localSelection: { scanners: expected, base: frozen.base, fingerprint: state.fingerprint },
            })
          }
          saveTask({ ...task, status: "done", finishedAt: now(), findings: result.findings.length })
        } catch (error) {
          saveTask({ ...task, status: control() === "cancel" || interrupted ? "cancelled" : "failed", finishedAt: now(), error: error.message })
        } finally {
          // Includes interrupted checkouts; published inputs are outside workspace.
          for (const folder of [".cache", ".osvcache"]) for (const suffix of ["", ".sparse"]) {
            const checkout = join(workspace, "benchmark", folder, `${repo.name}${suffix}`)
            if (existsSync(checkout)) rmSync(checkout, { recursive: true })
          }
          publish()
        }
      }
    }))
    state.status = interrupted ? "interrupted" : control() === "cancel" ? "cancelled" : control() === "pause" || diskBlocked ? "paused" : state.failed ? "completed_with_errors" : "completed"
    if (diskBlocked) state.error = "Paused: free disk space below configured minimum"
    state.finishedAt = now(); publish()
  } catch (error) {
    const workspace = join(directory, "workspace")
    if (existsSync(workspace) && !existsSync(join(workspace, "ready.json"))) rmSync(workspace, { recursive: true })
    state.status = interrupted ? "interrupted" : control() === "cancel" ? "cancelled" : error instanceof DiskReserveError ? "paused" : "failed"
    state.error = error.message; publish()
  } finally {
    process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal)
    if (read(lock)?.pid === process.pid) rmSync(lock)
  }
  return getRun(root, id)
}

export async function waitForRun(root, id) {
  while (true) {
    const state = getRun(root, id)
    if (!["queued", ...ACTIVE].includes(state.status)) return state
    await sleep(500)
  }
}

export async function exportRun(root, id) {
  const state = getRun(root, id)
  if (state.status !== "completed" || state.failed || state.done !== state.total) throw new Error("Only fully completed runs can be exported; finish or retry pending tasks first")
  const directory = runPath(root, id), workspace = join(directory, "workspace"), archive = join(directory, "results.tar.gz")
  const args = ["-czf", archive, "-C", directory, "plan.json", "state.json", "-C", workspace, "ready.json"]
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) args.push("pnpm-lock.yaml")
  const calibration = join(workspace, "packages/core/src")
  if (existsSync(join(calibration, "confidence-data.ts"))) args.push("-C", calibration, "confidence-data.ts")
  args.push("-C", join(workspace, "benchmark"), "corpus.json", ".results", ".inventory", ".history", ".gitlog")
  const result = spawnSync("tar", args, { stdio: ["ignore", "ignore", "pipe"] })
  if (result.error || result.status !== 0) throw new Error("Export failed; tar must be installed")
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  const sha256 = hash.digest("hex")
  writeFileSync(`${archive}.sha256`, `${sha256}  results.tar.gz\n`)
  return { archive, sha256, records: state.total }
}
