import { createHash, randomBytes } from "crypto"
import { safeEqual } from "@/lib/api-auth"

/**
 * Share capability keys.
 *
 * The public `token` opens a read-only snapshot. The `manageKey` is a separate
 * secret returned once to the publisher: it is what lets the same browser (or
 * anyone who kept the key) update the snapshot in place or revoke the link.
 * README badges stay on one URL because updates keep the public token.
 */

/** Same alphabet / length rules as the public token — path-safe, unguessable. */
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/

const MANAGE_BYTES = 18

export function isValidShareKey(value: string): boolean {
  return KEY_RE.test(value)
}

export function newManageKey(): string {
  return randomBytes(MANAGE_BYTES).toString("base64url")
}

/** Store only the digest. The raw manage key never lands in the share store. */
export function hashManageKey(manageKey: string): string {
  return createHash("sha256").update(manageKey, "utf8").digest("hex")
}

export function verifyManageKey(manageKey: string, manageKeyHash: string): boolean {
  if (!manageKey || !manageKeyHash || !isValidShareKey(manageKey)) return false
  return safeEqual(hashManageKey(manageKey), manageKeyHash)
}

/** Normalised `owner/name` used as the uniqueness key for one live share per repo. */
export function repoKeyOf(repo: { owner: string; name: string }): string {
  return `${repo.owner.trim()}/${repo.name.trim()}`.toLowerCase()
}
