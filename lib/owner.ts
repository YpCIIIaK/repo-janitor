import "server-only"
import { safeEqual } from "@/lib/api-auth"
import { readEnv } from "@/lib/env"

/**
 * The operator's own key: whoever runs this instance, exempt from the limits
 * meant for strangers.
 *
 * The public limits exist because `/api/scan` clones and scans arbitrary
 * repositories on our machine, and an anonymous caller must not be able to run
 * the box all day. None of that reasoning applies to the person paying for the
 * box. Rather than loosening the limits for everybody — which is the tempting,
 * wrong fix — this recognises one caller and leaves the rest as they were.
 *
 * ## What it does NOT exempt you from
 *
 * The concurrency cap still applies. That one is not an abuse control: it is
 * what keeps two simultaneous clones from exhausting the memory of a small
 * instance. Bypassing it would not give the owner more throughput, it would give
 * them an out-of-memory kill in the middle of their own scan. So an owner's
 * requests still queue for a slot — they simply never run out of allowance.
 *
 * ## Why a cookie and not a header
 *
 * The key is set once, by POSTing it to `/api/unlock`, which stores it in an
 * `httpOnly` cookie. That way it never lives in `localStorage`, is never
 * readable by page scripts, and cannot be lifted by anything that manages to
 * inject one. The browser then attaches it to same-origin requests on its own.
 */

const COOKIE = "rar_owner"

/** True when this deployment has an owner key configured at all. */
export function ownerKeyConfigured(): boolean {
  return Boolean(readEnv("REPO_ANTI_ROT_OWNER_TOKEN")?.trim())
}

/** Constant-time check of a supplied key against the configured one. */
export function isOwnerToken(token: string): boolean {
  const expected = readEnv("REPO_ANTI_ROT_OWNER_TOKEN")?.trim()
  // Unset means nobody is the owner — never "everybody is". An operator who has
  // not configured a key must not be handing out unlimited access by default.
  if (!expected) return false
  return Boolean(token) && safeEqual(token, expected)
}

/** Read the owner cookie off a request and check it. */
export function isOwner(request: Request): boolean {
  const header = request.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === COOKIE) return isOwnerToken(decodeURIComponent(rest.join("=")))
  }
  return false
}

export const OWNER_COOKIE = COOKIE
