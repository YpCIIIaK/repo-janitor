import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Shared bearer-token auth helpers for the API routes.
 *
 * Tokens are compared in constant time so a network attacker can't recover the
 * secret byte-by-byte from response-time differences. We hash both sides to a
 * fixed 32-byte digest first, which sidesteps `timingSafeEqual`'s equal-length
 * requirement and also avoids leaking the secret's length.
 */

/** Constant-time string equality (safe against timing attacks). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest()
  const hb = createHash("sha256").update(b, "utf8").digest()
  // Digests are always 32 bytes, so timingSafeEqual never throws here.
  return timingSafeEqual(ha, hb)
}

/** Extract the `Authorization: Bearer <token>` value, or "" when absent. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? ""
  return header.replace(/^Bearer\s+/i, "").trim()
}

/**
 * Validate a request's bearer token against an expected secret.
 *
 * When `expected` is empty/undefined the check is DISABLED (returns true) — this
 * keeps local dev frictionless; auth only switches on once the env var is set.
 * When enabled, the comparison is constant-time.
 */
export function checkBearer(request: Request, expected: string | undefined): boolean {
  if (!expected) return true
  return safeEqual(bearerToken(request), expected)
}
