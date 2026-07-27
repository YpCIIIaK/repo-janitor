import "server-only"
import { randomBytes } from "crypto"
import { promises as fs } from "fs"
import { join } from "path"
import { assertShareable, type SharedReport } from "@/lib/share-report"

/**
 * Storage for shared report links.
 *
 * One JSON file per share, keyed by an unguessable token. The path carries
 * owner/name for readability, but the token is what authorises the read: a
 * shared report should not be discoverable by typing someone's repo name, even
 * though it holds no paths or evidence (see lib/share-report.ts).
 *
 * KNOWN LIMITATION: this writes to the container filesystem, which is ephemeral
 * on most hosts — including Render's free tier, where there is no persistent
 * disk at all. Shared links do not survive a redeploy or a restart. That is
 * survivable while testing whether anyone shares at all, and unacceptable once
 * links are posted publicly; moving to a real store is the fix, not a longer
 * retention here.
 */

const DIR = join(process.cwd(), ".repo-anti-rot", "shared")

/** 96 bits of randomness: not enumerable, still short enough to paste in chat. */
const TOKEN_BYTES = 12

/** Bound on stored shares, oldest evicted first, so a disk cannot be filled slowly. */
const MAX_SHARES = 5_000

/**
 * Tokens are the only untrusted input that reaches a filesystem path, so the
 * shape is enforced rather than sanitised. Anything containing a separator or a
 * dot fails this and never becomes a path — `..%2F..%2Fetc%2Fpasswd` included.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

export function isValidShareToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

export function newShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

export interface StoredShare {
  token: string
  createdAt: string
  report: SharedReport
}

function fileFor(token: string): string {
  if (!isValidShareToken(token)) throw new Error("invalid share token")
  return join(DIR, `${token}.json`)
}

/**
 * Persist a shared report and return its token.
 *
 * `assertShareable` runs here as well as at projection time: storage is the last
 * point at which a payload can be stopped, and the only one a future caller
 * cannot bypass by building the object itself.
 */
export async function putShare(report: SharedReport): Promise<StoredShare> {
  assertShareable(report)

  const share: StoredShare = {
    token: newShareToken(),
    createdAt: new Date().toISOString(),
    report,
  }

  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(fileFor(share.token), JSON.stringify(share), "utf-8")
  await evictOldest().catch(() => {}) // best-effort: never fail a write over cleanup
  return share
}

/** Read a shared report. Returns null for an unknown, malformed or unreadable token. */
export async function getShare(token: string): Promise<StoredShare | null> {
  if (!isValidShareToken(token)) return null
  try {
    const raw = await fs.readFile(fileFor(token), "utf-8")
    const parsed = JSON.parse(raw) as StoredShare
    return parsed?.report ? parsed : null
  } catch {
    return null
  }
}

/** Trim the store to MAX_SHARES, dropping the least recently written first. */
async function evictOldest(): Promise<void> {
  const names = (await fs.readdir(DIR)).filter((n) => n.endsWith(".json"))
  if (names.length <= MAX_SHARES) return

  const withTimes = await Promise.all(
    names.map(async (name) => {
      const stat = await fs.stat(join(DIR, name)).catch(() => null)
      return { name, mtime: stat?.mtimeMs ?? 0 }
    }),
  )
  withTimes.sort((a, b) => a.mtime - b.mtime)

  const doomed = withTimes.slice(0, withTimes.length - MAX_SHARES)
  await Promise.all(doomed.map((f) => fs.rm(join(DIR, f.name), { force: true }).catch(() => {})))
}
