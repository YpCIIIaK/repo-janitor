import "server-only"
import { randomBytes } from "crypto"
import { promises as fs } from "fs"
import { join } from "path"
import { assertShareable, type SharedReport } from "@/lib/share-report"
import { dbGetShare, dbPutShare, supabaseConfig } from "@/lib/share-db"

/**
 * Storage for shared report links.
 *
 * Two backends, chosen by configuration:
 *
 *  - **Supabase** when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
 *    Use this anywhere the links are meant to outlive a deploy.
 *  - **Filesystem** otherwise — one JSON file per share. Local development and
 *    self-hosting need no account, and the tests need no network.
 *
 * The filesystem path is only viable where the disk survives: a container
 * filesystem is ephemeral on most hosts, and on Render's free tier there is no
 * persistent disk at all, so a redeploy silently breaks every link already
 * posted. That is the reason the database backend exists, and the reason it is
 * the one to configure before announcing anything publicly.
 *
 * Either way the token authorises the read. The path carries owner/name for
 * readability only: a shared report should not be discoverable by guessing a
 * repo name, even though it holds no paths or evidence (see lib/share-report.ts).
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

  const cfg = supabaseConfig()
  if (cfg) {
    // Let the error propagate: a share link that silently was not stored is
    // worse than a visible failure, because the user copies a dead URL.
    await dbPutShare(cfg, share.token, report)
    return share
  }

  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(fileFor(share.token), JSON.stringify(share), "utf-8")
  await evictOldest().catch(() => {}) // best-effort: never fail a write over cleanup
  return share
}

/** Read a shared report. Returns null for an unknown, malformed or unreadable token. */
export async function getShare(token: string): Promise<StoredShare | null> {
  if (!isValidShareToken(token)) return null

  const cfg = supabaseConfig()
  if (cfg) {
    try {
      return await dbGetShare(cfg, token)
    } catch {
      return null // a database hiccup renders as "no such report", never as a 500
    }
  }

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
