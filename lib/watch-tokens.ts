import { randomBytes } from "crypto"

/**
 * Capability tokens for watch subscriptions.
 *
 * Same alphabet / length rules as share tokens: path-safe, unguessable, never
 * sanitised into a filesystem path — the shape is enforced instead.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/
const TOKEN_BYTES = 18

export function isValidWatchToken(value: string): boolean {
  return TOKEN_RE.test(value)
}

export function newWatchToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

/** Opaque row id — not a capability, just a stable primary key. */
export function newWatchId(): string {
  return randomBytes(12).toString("base64url")
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Normalise + validate an address. Null when unusable. */
export function normalizeWatchEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase().slice(0, 254)
  if (email.length < 5 || email.length > 254) return null
  if (!EMAIL_RE.test(email)) return null
  return email
}
