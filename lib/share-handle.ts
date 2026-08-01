/**
 * Browser-side handle for a published share.
 *
 * The public token is in the URL people paste into READMEs. The manage key stays
 * in this browser so the same machine can refresh the snapshot or revoke the
 * link without minting a new URL. Nothing here is a server secret beyond what
 * the publisher already received from POST /api/share.
 */

const STORAGE_KEY = "repo-anti-rot.share-handles"

export interface ShareHandle {
  token: string
  manageKey: string
  owner: string
  name: string
  path: string
  updatedAt: string
}

function storageKey(owner: string, name: string): string {
  return `${owner.trim()}/${name.trim()}`.toLowerCase()
}

function readAll(): Record<string, ShareHandle> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ShareHandle>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, ShareHandle>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* quota / private mode — publishing still works for this session */
  }
}

export function loadShareHandle(owner: string, name: string): ShareHandle | null {
  const hit = readAll()[storageKey(owner, name)]
  if (!hit?.token || !hit?.manageKey || !hit?.path) return null
  return hit
}

export function saveShareHandle(handle: ShareHandle): void {
  const all = readAll()
  all[storageKey(handle.owner, handle.name)] = handle
  writeAll(all)
}

export function clearShareHandle(owner: string, name: string): void {
  const all = readAll()
  delete all[storageKey(owner, name)]
  writeAll(all)
}

/** Pull owner/name off a scan report without trusting the rest of the shape. */
export function repoFromReport(report: unknown): { owner: string; name: string } | null {
  const repo = (report as { repo?: { owner?: unknown; name?: unknown } } | null)?.repo
  const owner = typeof repo?.owner === "string" ? repo.owner.trim() : ""
  const name = typeof repo?.name === "string" ? repo.name.trim() : ""
  if (!owner || !name) return null
  return { owner, name }
}
