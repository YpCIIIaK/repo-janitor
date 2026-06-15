import { mkdir, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { createHash } from "crypto"

/**
 * Disk cache for per-commit scan reports, keyed by repo URL + commit sha.
 *
 * A commit sha is immutable, so its scan result never changes — caching it means
 * re-opening a repo's history tree costs nothing for commits already scanned, and
 * only newly-sampled commits do real work. Best-effort: any IO failure degrades to
 * a cache miss (the caller just rescans), never an error.
 */

const CACHE_DIR = join(tmpdir(), "repo-anti-rot-scan-cache")

/** Stable, filesystem-safe filename for a (url, sha) pair. */
function cacheFile(url: string, sha: string): string {
  const key = createHash("sha256").update(`${url}\n${sha}`).digest("hex")
  return join(CACHE_DIR, `${key}.json`)
}

/** Return a cached report for this commit, or null on a miss / unreadable entry. */
export async function getCachedScan(url: string, sha: string): Promise<unknown | null> {
  try {
    const raw = await readFile(cacheFile(url, sha), "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Persist a commit's scan report. Never throws — caching is an optimization. */
export async function putCachedScan(url: string, sha: string, report: unknown): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cacheFile(url, sha), JSON.stringify(report), "utf-8")
  } catch {
    /* cache write failed — the scan still succeeded, just isn't memoized */
  }
}
