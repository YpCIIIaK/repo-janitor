import "server-only"
import { randomUUID } from "node:crypto"
import { withStorageLock } from "@/lib/storage-io"
import { packResults, readJob, writeJob } from "@/lib/scan-job-storage"
import type { ScanResult, ScanProgressState } from "@/lib/scan-client"

export const JOB_TTL_MS = 24 * 60 * 60 * 1000
const processState = globalThis as typeof globalThis & { rarJobWorker?: string }
const worker = processState.rarJobWorker ??= randomUUID()
export const validJobId = (id: string) => /^[a-f0-9]{64}$/.test(id)
export interface ScanJob {
  id: string
  worker: string
  urls: string[]
  createdAt: number
  expiresAt: number
  status: "queued" | "running" | "saving" | "completed" | "failed"
  progress: ScanProgressState
  results: ScanResult[]
  archiveInfo?: { compressedBytes: number; originalBytes: number }
  error?: string
}

export async function getScanJob(id: string, includeArchive = false): Promise<ScanJob | null> {
  if (!validJobId(id)) return null
  const job = await readJob(id, includeArchive)
  if (!job) return null
  // A different worker handling a GET is not proof of failure. Bound orphaned
  // jobs by their execution deadline instead; never replay work automatically.
  if (!["completed", "failed"].includes(job.status) && Date.now() - job.createdAt > 720_000) {
    job.status = "failed"
    job.error = "The server restarted or the scan exceeded its deadline before saving. Start a new scan to retry."
  }
  return job
}

export async function createScanJob(id: string, urls: string[]): Promise<{ job: ScanJob; created: boolean }> {
  if (!validJobId(id)) throw new Error("Invalid scan job ID")
  return withStorageLock(async () => {
    const existing = await getScanJob(id)
    if (existing) return { job: existing, created: false }
    const now = Date.now()
    const job: ScanJob = {
      id, worker, urls, createdAt: now, expiresAt: now + JOB_TTL_MS,
      status: "queued", results: [],
      progress: { fraction: 0, label: "Queued", reposDone: 0, reposTotal: urls.length },
    }
    const created = await writeJob(job, { insert: true })
    if (!created) {
      const existing = await getScanJob(id)
      if (!existing) throw new Error("Scan admission conflict")
      return { job: existing, created: false }
    }
    return { job, created }
  })
}

type JobEvent = { type: string; url?: string; phase?: string; scanner?: string; completed?: number; total?: number; position?: number; ok?: boolean; report?: unknown; error?: string }

export async function executeScanJob(job: ScanJob, task: (emit: (event: JobEvent) => void, signal: AbortSignal) => Promise<void>) {
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), 700_000)
  let writes = Promise.resolve()
  let storageError = false
  let lastSaved = 0
  const saveProgress = () => {
    if (Date.now() - lastSaved < 15_000) return
    lastSaved = Date.now()
    const snapshot = { ...job, results: [], progress: { ...job.progress } }
    writes = writes.then(async () => { await writeJob(snapshot) }).catch(() => { storageError = true; abort.abort() })
  }
  try {
    job.status = "running"
    saveProgress()
    await task((event) => {
      if (abort.signal.aborted) return
      const done = job.results.length
      let fraction = 0
      let label = job.progress.label
      if (event.type === "queued") label = `Waiting for a scan slot · queue ${event.position}`
      if (event.type === "phase") {
        fraction = event.phase === "clone" ? 0.05 : event.phase === "activity" ? 0.95 : 0.15
        label = event.phase === "activity" ? "Loading commit history…" : event.phase === "clone" ? "Cloning…" : "Scanning…"
      }
      if (event.type === "scanner") {
        fraction = 0.15 + 0.8 * Math.min(1, (event.completed ?? 0) / Math.max(1, event.total ?? 1))
        label = `Scanning · ${event.scanner ?? "checks"}`
      }
      if (event.type === "repo-done" && event.url && job.urls.includes(event.url) && !job.results.some((r) => r.url === event.url)) {
        job.results.push({ url: event.url, ok: event.ok === true, report: event.report, error: event.error } as ScanResult)
        fraction = 1
      }
      job.progress = { fraction: Math.min(0.98, (done + fraction) / job.urls.length), label, reposDone: job.results.length, reposTotal: job.urls.length }
      saveProgress()
    }, abort.signal)
    await writes
    if (storageError || abort.signal.aborted || job.results.length !== job.urls.length) throw new Error("Scan interrupted")
  } catch {
    job.error = "Scan interrupted, timed out, or storage was unavailable. Retry unfinished repositories."
  } finally {
    clearTimeout(deadline)
    await writes
  }
  // Progress writes contain metadata only; full results are compressed once.
  job.status = "saving"
  job.progress.label = "Compressing and saving the full report…"
  await writeJob({ ...job, results: [] })
  try {
    const { archive, ...archiveInfo } = await packResults(job.results)
    job.archiveInfo = archiveInfo
    job.status = !job.error && job.results.every((r) => r.ok) ? "completed" : "failed"
    job.progress = { ...job.progress, fraction: 1, label: job.status === "completed" ? "Full report saved" : "Scan finished with errors" }
    await writeJob(job, { archive })
  } catch (err) {
    job.status = "failed"
    job.archiveInfo = undefined
    job.error = err instanceof Error ? err.message : "Could not archive the full report. Nothing was truncated. Please retry."
    job.progress.label = "Full report could not be saved"
    await writeJob({ ...job, results: [] })
  }
}
