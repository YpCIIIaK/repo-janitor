import "server-only"
import { promises as fs } from "fs"
import { join } from "path"
import { supabaseConfig } from "@/lib/share-db"
import { repoKeyOf } from "@/lib/share-keys"
import type { Grade } from "@/lib/mock-data"
import {
  dbDeleteWatch,
  dbFindManageTokenForEmail,
  dbGetWatchByEmailRepo,
  dbGetWatchByUnsub,
  dbListByManageToken,
  dbListDueWatches,
  dbUpdateWatchCheckpoint,
  dbUpsertWatch,
  type WatchSubscription,
} from "@/lib/watch-db"
import { isValidWatchToken, newWatchId, newWatchToken } from "@/lib/watch-tokens"

/**
 * Watch subscription store — Supabase when configured, else one JSON file.
 *
 * Filesystem is fine locally; on Render free the disk is ephemeral, so configure
 * Supabase before announcing watches publicly (same rule as share links).
 */

export type { WatchSubscription }

const FILE = join(process.cwd(), ".repo-anti-rot", "watch-subscriptions.json")
const MAX_WATCHES = 10_000

type FileStore = { watches: WatchSubscription[] }

async function readFileStore(): Promise<FileStore> {
  try {
    const raw = await fs.readFile(FILE, "utf-8")
    const parsed = JSON.parse(raw) as FileStore
    if (!parsed || !Array.isArray(parsed.watches)) return { watches: [] }
    return parsed
  } catch {
    return { watches: [] }
  }
}

async function writeFileStore(store: FileStore): Promise<void> {
  await fs.mkdir(join(process.cwd(), ".repo-anti-rot"), { recursive: true })
  // Evict oldest when over cap.
  if (store.watches.length > MAX_WATCHES) {
    store.watches.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    store.watches = store.watches.slice(-MAX_WATCHES)
  }
  await fs.writeFile(FILE, JSON.stringify(store), "utf-8")
}

export type SubscribeInput = {
  email: string
  owner: string
  name: string
  repoUrl: string
  grade: Grade
  score: number
  sha?: string | null
  /** Optional baseline issue ids from the scan that created the watch. */
  issueIds?: string[]
}

export type SubscribeResult = {
  subscription: WatchSubscription
  created: boolean
  managePath: string
}

function managePathOf(manageToken: string): string {
  return `/watch/${manageToken}`
}

/**
 * Create or refresh a watch for (email, owner, name).
 * Reuses an existing manage_token for this email when one exists.
 */
export async function subscribeWatch(input: SubscribeInput): Promise<SubscribeResult> {
  const owner = input.owner.trim()
  const name = input.name.trim()
  const email = input.email
  const now = new Date().toISOString()
  const cfg = supabaseConfig()

  if (cfg) {
    const existing = await dbGetWatchByEmailRepo(cfg, email, owner, name)
    const manageToken =
      existing?.manageToken ??
      (await dbFindManageTokenForEmail(cfg, email)) ??
      newWatchToken()

    if (existing) {
      const next: WatchSubscription = {
        ...existing,
        repoUrl: input.repoUrl,
        lastGrade: input.grade,
        lastScore: input.score,
        lastSha: input.sha ?? existing.lastSha,
        lastIssueIds: input.issueIds ?? existing.lastIssueIds ?? [],
        // Keep lastCheckedAt — cron owns the check clock; subscribe resets baseline only.
      }
      await dbUpsertWatch(cfg, next)
      return { subscription: next, created: false, managePath: managePathOf(manageToken) }
    }

    const sub: WatchSubscription = {
      id: newWatchId(),
      email,
      owner,
      name,
      repoUrl: input.repoUrl,
      lastGrade: input.grade,
      lastScore: input.score,
      lastSha: input.sha ?? null,
      lastIssueIds: input.issueIds ?? [],
      lastCheckedAt: now,
      lastNotifiedAt: null,
      createdAt: now,
      unsubToken: newWatchToken(),
      manageToken,
    }
    await dbUpsertWatch(cfg, sub)
    return { subscription: sub, created: true, managePath: managePathOf(manageToken) }
  }

  // Filesystem backend
  const store = await readFileStore()
  const existing = store.watches.find(
    (w) => w.email === email && w.owner === owner && w.name === name,
  )
  const manageToken =
    existing?.manageToken ??
    store.watches.find((w) => w.email === email)?.manageToken ??
    newWatchToken()

  if (existing) {
    existing.repoUrl = input.repoUrl
    existing.lastGrade = input.grade
    existing.lastScore = input.score
    if (input.sha) existing.lastSha = input.sha
    if (input.issueIds) existing.lastIssueIds = input.issueIds
    else if (!existing.lastIssueIds) existing.lastIssueIds = []
    await writeFileStore(store)
    return { subscription: existing, created: false, managePath: managePathOf(manageToken) }
  }

  const sub: WatchSubscription = {
    id: newWatchId(),
    email,
    owner,
    name,
    repoUrl: input.repoUrl,
    lastGrade: input.grade,
    lastScore: input.score,
    lastSha: input.sha ?? null,
    lastIssueIds: input.issueIds ?? [],
    lastCheckedAt: now,
    lastNotifiedAt: null,
    createdAt: now,
    unsubToken: newWatchToken(),
    manageToken,
  }
  store.watches.push(sub)
  await writeFileStore(store)
  return { subscription: sub, created: true, managePath: managePathOf(manageToken) }
}

export async function unsubscribeByToken(unsubToken: string): Promise<boolean> {
  if (!isValidWatchToken(unsubToken)) return false
  const cfg = supabaseConfig()
  if (cfg) {
    const sub = await dbGetWatchByUnsub(cfg, unsubToken)
    if (!sub) return false
    await dbDeleteWatch(cfg, sub.id)
    return true
  }
  const store = await readFileStore()
  const before = store.watches.length
  store.watches = store.watches.filter((w) => w.unsubToken !== unsubToken)
  if (store.watches.length === before) return false
  await writeFileStore(store)
  return true
}

export async function listWatchesByManageToken(
  manageToken: string,
): Promise<WatchSubscription[]> {
  if (!isValidWatchToken(manageToken)) return []
  const cfg = supabaseConfig()
  if (cfg) return dbListByManageToken(cfg, manageToken)
  const store = await readFileStore()
  return store.watches.filter((w) => w.manageToken === manageToken)
}

export async function findManageTokenForEmail(email: string): Promise<string | null> {
  const cfg = supabaseConfig()
  if (cfg) return dbFindManageTokenForEmail(cfg, email)
  const store = await readFileStore()
  return store.watches.find((w) => w.email === email)?.manageToken ?? null
}

export async function updateWatchCheckpoint(
  id: string,
  patch: {
    lastGrade: Grade
    lastScore: number
    lastSha: string | null
    lastCheckedAt: string
    lastNotifiedAt?: string | null
    lastIssueIds?: string[]
  },
): Promise<void> {
  const cfg = supabaseConfig()
  if (cfg) {
    await dbUpdateWatchCheckpoint(cfg, id, patch)
    return
  }
  const store = await readFileStore()
  const sub = store.watches.find((w) => w.id === id)
  if (!sub) return
  sub.lastGrade = patch.lastGrade
  sub.lastScore = patch.lastScore
  sub.lastSha = patch.lastSha
  sub.lastCheckedAt = patch.lastCheckedAt
  if (patch.lastNotifiedAt !== undefined) sub.lastNotifiedAt = patch.lastNotifiedAt
  if (patch.lastIssueIds !== undefined) sub.lastIssueIds = patch.lastIssueIds
  await writeFileStore(store)
}

/** Subscriptions due for a cron check (null or older than 24h by default). */
export async function listDueWatches(
  limit: number,
  olderThanMs = 24 * 60 * 60 * 1000,
): Promise<WatchSubscription[]> {
  const olderThanIso = new Date(Date.now() - olderThanMs).toISOString()
  const cfg = supabaseConfig()
  if (cfg) return dbListDueWatches(cfg, olderThanIso, limit)

  const store = await readFileStore()
  return store.watches
    .filter((w) => !w.lastCheckedAt || w.lastCheckedAt < olderThanIso)
    .sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""))
    .slice(0, limit)
}

/** Repo key helper re-export for callers that already hold owner/name. */
export function watchRepoKey(owner: string, name: string): string {
  return repoKeyOf({ owner, name })
}
