import "server-only"
import { randomBytes } from "crypto"
import { promises as fs } from "fs"
import { join } from "path"
import { assertShareable, type SharedReport } from "@/lib/share-report"
import {
  dbDeleteShare,
  dbGetShare,
  dbGetShareByRepoKey,
  dbPutShare,
  dbUpdateShare,
  supabaseConfig,
} from "@/lib/share-db"
import {
  hashManageKey,
  isValidShareKey,
  newManageKey,
  repoKeyOf,
  verifyManageKey,
} from "@/lib/share-keys"

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
 * Stable publishing: one live share per `owner/name`. Re-publishing with the
 * manage key updates the snapshot in place so README badge / card / embed URLs
 * keep working. Revoke deletes the row; rotate mints a new public token (same
 * manage key) when the old URL must be invalidated.
 */

const DIR = join(process.cwd(), ".repo-anti-rot", "shared")
const BY_REPO_DIR = join(DIR, "by-repo")

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
  updatedAt: string
  repoKey: string
  /** SHA-256 hex of the manage key. Empty for legacy rows that cannot be managed. */
  manageKeyHash: string
  report: SharedReport
}

export type PublishShareResult =
  | { ok: true; share: StoredShare; manageKey: string; created: boolean }
  | { ok: false; code: "missing_key" | "forbidden"; message: string }

function fileFor(token: string): string {
  if (!isValidShareToken(token)) throw new Error("invalid share token")
  return join(DIR, `${token}.json`)
}

/** Filename-safe index entry for a repo key (owner/name may contain odd chars). */
function repoIndexFile(repoKey: string): string {
  const safe = Buffer.from(repoKey, "utf8").toString("base64url")
  return join(BY_REPO_DIR, `${safe}.json`)
}

async function writeRepoIndex(repoKey: string, token: string): Promise<void> {
  await fs.mkdir(BY_REPO_DIR, { recursive: true })
  await fs.writeFile(repoIndexFile(repoKey), JSON.stringify({ token }), "utf-8")
}

async function readRepoIndex(repoKey: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(repoIndexFile(repoKey), "utf-8")
    const parsed = JSON.parse(raw) as { token?: string }
    return typeof parsed?.token === "string" ? parsed.token : null
  } catch {
    return null
  }
}

async function clearRepoIndex(repoKey: string): Promise<void> {
  await fs.rm(repoIndexFile(repoKey), { force: true }).catch(() => {})
}

function toStored(raw: unknown): StoredShare | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Partial<StoredShare>
  if (!obj.token || !obj.report?.repo) return null
  const createdAt = obj.createdAt ?? new Date(0).toISOString()
  return {
    token: obj.token,
    createdAt,
    updatedAt: obj.updatedAt ?? createdAt,
    repoKey: obj.repoKey ?? repoKeyOf(obj.report.repo),
    manageKeyHash: obj.manageKeyHash ?? "",
    report: obj.report,
  }
}

/**
 * Persist a brand-new share (always mints a fresh public token).
 * Prefer {@link publishShare} for the product path — it keeps URLs stable.
 */
export async function putShare(report: SharedReport): Promise<StoredShare & { manageKey: string }> {
  const published = await publishShare(report, {})
  if (!published.ok) throw new Error(published.message)
  return { ...published.share, manageKey: published.manageKey }
}

/**
 * Create or update the live share for this repository.
 *
 * - No existing share → mint token + manage key.
 * - Existing share + matching manage key → refresh the snapshot (same token).
 * - Existing share + `rotate: true` → new public token, same manage key.
 * - Existing share without / wrong manage key → error (does not mint a second URL).
 */
export async function publishShare(
  report: SharedReport,
  opts: { manageKey?: string; rotate?: boolean } = {},
): Promise<PublishShareResult> {
  assertShareable(report)
  const repoKey = repoKeyOf(report.repo)
  const existing = await getShareByRepoKey(repoKey)

  if (!existing) {
    const manageKey = newManageKey()
    const now = new Date().toISOString()
    const share: StoredShare = {
      token: newShareToken(),
      createdAt: now,
      updatedAt: now,
      repoKey,
      manageKeyHash: hashManageKey(manageKey),
      report,
    }
    await writeShare(share)
    return { ok: true, share, manageKey, created: true }
  }

  const manageKey = opts.manageKey?.trim() ?? ""
  if (!manageKey) {
    return {
      ok: false,
      code: "missing_key",
      message:
        "A share link already exists for this repository. Pass the manage key from the browser that created it to update the snapshot.",
    }
  }
  if (!existing.manageKeyHash || !verifyManageKey(manageKey, existing.manageKeyHash)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Manage key does not match this share link.",
    }
  }

  const now = new Date().toISOString()

  if (opts.rotate) {
    await removeShareRecord(existing)
    const share: StoredShare = {
      token: newShareToken(),
      createdAt: existing.createdAt,
      updatedAt: now,
      repoKey,
      manageKeyHash: existing.manageKeyHash,
      report,
    }
    await writeShare(share)
    return { ok: true, share, manageKey, created: false }
  }

  const share: StoredShare = {
    ...existing,
    updatedAt: now,
    report,
  }
  await writeShare(share, { update: true })
  return { ok: true, share, manageKey, created: false }
}

export async function revokeShare(opts: {
  token?: string
  manageKey: string
  owner?: string
  name?: string
}): Promise<{ ok: true } | { ok: false; code: "not_found" | "forbidden"; message: string }> {
  const manageKey = opts.manageKey.trim()
  if (!isValidShareKey(manageKey)) {
    return { ok: false, code: "forbidden", message: "Invalid manage key." }
  }

  let share: StoredShare | null = null
  if (opts.token) {
    share = await getShare(opts.token)
  } else if (opts.owner && opts.name) {
    share = await getShareByRepoKey(repoKeyOf({ owner: opts.owner, name: opts.name }))
  }

  if (!share) {
    return { ok: false, code: "not_found", message: "Share link not found." }
  }
  if (!share.manageKeyHash || !verifyManageKey(manageKey, share.manageKeyHash)) {
    return { ok: false, code: "forbidden", message: "Manage key does not match this share link." }
  }

  await removeShareRecord(share)
  return { ok: true }
}

async function writeShare(share: StoredShare, opts: { update?: boolean } = {}): Promise<void> {
  const cfg = supabaseConfig()
  if (cfg) {
    const payload = {
      token: share.token,
      manageKeyHash: share.manageKeyHash,
      repoKey: share.repoKey,
      updatedAt: share.updatedAt,
      report: share.report,
    }
    if (opts.update) await dbUpdateShare(cfg, payload)
    else await dbPutShare(cfg, payload)
    return
  }

  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(fileFor(share.token), JSON.stringify(share), "utf-8")
  await writeRepoIndex(share.repoKey, share.token)
  await evictOldest().catch(() => {})
}

async function removeShareRecord(share: StoredShare): Promise<void> {
  const cfg = supabaseConfig()
  if (cfg) {
    await dbDeleteShare(cfg, share.token)
    return
  }
  await fs.rm(fileFor(share.token), { force: true }).catch(() => {})
  await clearRepoIndex(share.repoKey)
}

/** Read a shared report. Returns null for an unknown, malformed or unreadable token. */
export async function getShare(token: string): Promise<StoredShare | null> {
  if (!isValidShareToken(token)) return null

  const cfg = supabaseConfig()
  if (cfg) {
    try {
      return await dbGetShare(cfg, token)
    } catch {
      return null
    }
  }

  try {
    const raw = await fs.readFile(fileFor(token), "utf-8")
    return toStored(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function getShareByRepoKey(repoKey: string): Promise<StoredShare | null> {
  if (!repoKey.includes("/")) return null

  const cfg = supabaseConfig()
  if (cfg) {
    try {
      return await dbGetShareByRepoKey(cfg, repoKey)
    } catch {
      return null
    }
  }

  const token = await readRepoIndex(repoKey)
  if (!token) return null
  const share = await getShare(token)
  if (!share || share.repoKey !== repoKey) {
    await clearRepoIndex(repoKey)
    return null
  }
  return share
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
  for (const f of doomed) {
    try {
      const raw = await fs.readFile(join(DIR, f.name), "utf-8")
      const share = toStored(JSON.parse(raw))
      if (share?.repoKey) await clearRepoIndex(share.repoKey)
    } catch {
      /* ignore */
    }
    await fs.rm(join(DIR, f.name), { force: true }).catch(() => {})
  }
}
