import { mkdir, readFile, readdir, stat, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { createHash } from "crypto"
import { writeJsonAtomic, withStorageLock } from "@/lib/storage-io"

/**
 * Disk cache for per-commit scan reports, keyed by repo URL + commit sha.
 *
 * Code is immutable, but advisories and dependency status are not. Cache for at
 * most 24 hours and cap disk use. Best-effort: any IO failure degrades to
 * a cache miss (the caller just rescans), never an error.
 */

const CACHE_DIR = join(tmpdir(), "repo-anti-rot-scan-cache")
const TTL_MS = 24 * 60 * 60_000
const CACHE_VERSION = "2026-09-05"

/** Stable, filesystem-safe filename for a (url, sha) pair. */
function cacheFile(url: string, sha: string): string {
  const key = createHash("sha256").update(`${CACHE_VERSION}\n${url}\n${sha}`).digest("hex")
  return join(CACHE_DIR, `${key}.json`)
}

/** Return a cached report for this commit, or null on a miss / unreadable entry. */
export async function getCachedScan(url: string, sha: string): Promise<unknown | null> {
  try {
    const info = await stat(cacheFile(url, sha))
    if (Date.now() - info.mtimeMs > TTL_MS || info.size > 2 * 1024 * 1024) return null
    const raw = await readFile(cacheFile(url, sha), "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Persist a commit's scan report. Never throws — caching is an optimization. */
export async function putCachedScan(url: string, sha: string, report: unknown): Promise<void> {
  try {
    if (Buffer.byteLength(JSON.stringify(report)) > 2 * 1024 * 1024) return
    await withStorageLock(async () => {
      await mkdir(CACHE_DIR, { recursive: true })
      await writeJsonAtomic(cacheFile(url, sha), report)
      const entries = await Promise.all((await readdir(CACHE_DIR)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map(async (name) => ({ name, at: (await stat(join(CACHE_DIR, name))).mtimeMs })))
      entries.sort((a, b) => b.at - a.at)
      for (let index = 0; index < entries.length; index++) {
        if (index >= 500 || Date.now() - entries[index].at > TTL_MS) await rm(join(CACHE_DIR, entries[index].name), { force: true })
      }
    })
  } catch {
    /* cache write failed — the scan still succeeded, just isn't memoized */
  }
}
