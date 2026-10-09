import "server-only"
import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { gzip, gunzip } from "node:zlib"
import { promisify } from "node:util"
import { dataDir } from "@/lib/data-dir"
import { writeJsonAtomic } from "@/lib/storage-io"
import { restHeaders, supabaseConfig, withTimeout } from "@/lib/share-db"
import type { ScanJob } from "@/lib/scan-jobs"

const zip = promisify(gzip)
const unzip = promisify(gunzip)
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024
const MAX_RAW_BYTES = 64 * 1024 * 1024
const dir = () => join(dataDir(), "scan-jobs")
type Stored = { id: string; expires_at: string; metadata: Omit<ScanJob, "results">; archive?: string | null }

export async function packResults(results: ScanJob["results"]) {
  const raw = Buffer.from(JSON.stringify(results))
  if (raw.length > MAX_RAW_BYTES) throw new Error("Full report exceeds the safe uncompressed size (64 MiB). Nothing was truncated; use the CLI to save it locally.")
  const compressed = await zip(raw)
  if (compressed.length > MAX_ARCHIVE_BYTES) throw new Error("Full report exceeds the compressed storage limit (2 MiB). Nothing was truncated; use the CLI to save it locally.")
  return { archive: compressed.toString("base64"), compressedBytes: compressed.length, originalBytes: raw.length }
}

export async function unpackResults(archive: string): Promise<ScanJob["results"]> {
  if (archive.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4) throw new Error("Invalid archive size")
  const raw = await unzip(Buffer.from(archive, "base64"), { maxOutputLength: MAX_RAW_BYTES })
  const results = JSON.parse(raw.toString("utf8"))
  if (!Array.isArray(results)) throw new Error("Invalid report archive")
  return results
}

async function request(query: string, init: RequestInit = {}) {
  const cfg = supabaseConfig()
  if (!cfg) throw new Error("Supabase not configured")
  const response = await withTimeout(8_000, (signal) => fetch(`${cfg.url}/rest/v1/scan_jobs${query}`, {
    ...init, headers: { ...restHeaders(cfg), ...init.headers }, signal, cache: "no-store",
  }))
  if (!response.ok) throw new Error(`Scan job storage unavailable (${response.status}). Check the scan_jobs migration.`)
  return response
}

export async function readJob(id: string, includeArchive = false): Promise<ScanJob | null> {
  let row: Stored | undefined
  if (supabaseConfig()) {
    const params = new URLSearchParams({ id: `eq.${id}`, select: includeArchive ? "metadata,archive" : "metadata", limit: "1", expires_at: `gt.${new Date().toISOString()}` })
    const rows = await (await request(`?${params}`)).json() as Stored[]
    row = rows[0]
  } else {
    try { row = JSON.parse(await readFile(join(dir(), `${id}.json`), "utf8")) }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err }
  }
  if (!row || row.metadata.expiresAt <= Date.now()) return null
  return { ...row.metadata, results: includeArchive && row.archive ? await unpackResults(row.archive) : [] }
}

export async function writeJob(job: ScanJob, options: { insert?: boolean; archive?: string } = {}): Promise<boolean> {
  const { results: _results, ...metadata } = job
  void _results
  const row: Stored = { id: job.id, expires_at: new Date(job.expiresAt).toISOString(), metadata }
  if (options.archive !== undefined) row.archive = options.archive
  if (supabaseConfig()) {
    if (options.insert) {
      const response = await request("?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row) })
      return ((await response.json()) as unknown[]).length > 0
    }
    const response = await request(`?id=eq.${job.id}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) })
    if (!((await response.json()) as unknown[]).length) throw new Error("Scan job disappeared while saving")
  } else {
    if (options.insert) {
      const files = await readdir(dir()).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return []; throw err })
      let count = 0
      for (const name of files) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
        const old = JSON.parse(await readFile(join(dir(), name), "utf8")) as Stored
        if (old.metadata.expiresAt <= Date.now()) await rm(join(dir(), name), { force: true })
        else count++
      }
      if (count >= 32) throw new Error("Background scan storage is full. Try again later.")
    }
    await writeJsonAtomic(join(dir(), `${job.id}.json`), row)
  }
  return true
}
