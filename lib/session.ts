import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Signed, stateless sessions.
 *
 * ## Why there is no session table
 *
 * This project deliberately has no accounts — see `lib/hunter.ts` for the full
 * argument. RLS carries no policies, usage rows are anonymous, and the consent
 * text describes exactly what is stored. A users table would invalidate all
 * three at once, and it would do it for a feature that does not need one.
 *
 * What signing in actually has to establish is one fact: the person holding this
 * browser is @login. GitHub asserts that during the OAuth exchange, and a signed
 * cookie carries the assertion afterwards. The server stores nothing, so there
 * is no new personal data, nothing to leak, and nothing the consent text needs
 * to start mentioning.
 *
 * The cost is the honest one: a session cannot be revoked server-side before it
 * expires, because there is no record of it to revoke. That is why the lifetime
 * is days rather than months, and why nothing here is a capability — the cookie
 * says who you are, never what you may do. Anything destructive must re-check
 * against GitHub rather than trusting this.
 *
 * ## Why not JWT
 *
 * A JWT would be this plus an algorithm field that has caused a decade of
 * `alg: none` bugs. One algorithm, no negotiation, no library.
 */

/** `payload.signature`, both base64url. */
const SEPARATOR = "."

/**
 * Eight days. Long enough that signing in weekly is not a chore, short enough
 * that a stolen cookie is not a standing key — the whole trade for having
 * nothing to revoke against.
 */
export const SESSION_TTL_SECONDS = 8 * 24 * 60 * 60

export const SESSION_COOKIE = "rar_session"

export interface Session {
  /** GitHub login. The only identity claim in here. */
  login: string
  /** Issued at, epoch seconds. */
  iat: number
  /** Expires at, epoch seconds. */
  exp: number
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

/**
 * Constant-time compare of two signatures.
 *
 * Length is compared first and separately: `timingSafeEqual` throws on a length
 * mismatch, and a thrown exception is itself a signal. Signature lengths are
 * fixed here, so leaking that check costs nothing.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Mint a session cookie value for `login`.
 *
 * `now` is injectable so expiry is testable without waiting eight days.
 */
export function createSession(login: string, secret: string, now = Date.now()): string {
  if (!secret) throw new Error("session secret is not configured")

  const iat = Math.floor(now / 1000)
  const session: Session = { login, iat, exp: iat + SESSION_TTL_SECONDS }
  const payload = b64url(JSON.stringify(session))
  return `${payload}${SEPARATOR}${sign(payload, secret)}`
}

/**
 * Verify a cookie value and return the session, or null.
 *
 * Null for every failure — bad signature, expired, malformed, wrong shape —
 * because a caller that can distinguish them will eventually branch on the
 * difference, and "expired" versus "forged" is not a distinction worth exposing
 * to whoever sent the cookie.
 *
 * An unconfigured secret means no session is ever valid. Failing open here would
 * turn a missing environment variable into an authentication bypass, which is
 * the single worst way for a deploy to be misconfigured.
 */
export function readSession(
  value: string | undefined | null,
  secret: string | undefined,
  now = Date.now(),
): Session | null {
  if (!value || !secret) return null

  const cut = value.indexOf(SEPARATOR)
  if (cut <= 0) return null

  const payload = value.slice(0, cut)
  const signature = value.slice(cut + 1)
  if (!signature) return null

  // Signature before parsing: never hand unverified bytes to JSON.parse.
  if (!safeEqual(signature, sign(payload, secret))) return null

  let session: unknown
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }

  if (!session || typeof session !== "object") return null
  const { login, iat, exp } = session as Record<string, unknown>

  if (typeof login !== "string" || !login) return null
  if (typeof iat !== "number" || typeof exp !== "number") return null
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null
  if (exp <= Math.floor(now / 1000)) return null

  return { login, iat, exp }
}

/**
 * Cookie attributes.
 *
 * `httpOnly` so no page script can read the session, `sameSite=lax` so it
 * survives the redirect back from GitHub while not riding along on cross-site
 * form posts, and `secure` everywhere except local http, where it would stop
 * the cookie being set at all.
 */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  }
}

/** True when the request arrived over https, directly or through a proxy. */
export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")
  if (proto) return proto.split(",")[0].trim() === "https"
  return new URL(request.url).protocol === "https:"
}

/**
 * The origin a browser actually typed, not the one the server sees.
 *
 * Behind a TLS-terminating proxy — which is every PaaS, this deploy included —
 * `request.url` reports the internal hop: `http://…`, sometimes an internal
 * hostname. Building an OAuth `redirect_uri` from it sends GitHub a URL that
 * does not match the one registered on the app, and GitHub refuses the whole
 * sign-in with "the redirect_uri is not associated with this application".
 *
 * `PUBLIC_ORIGIN` wins when set, because a header is a guess and configuration
 * is not. Otherwise the forwarded pair is used, then the plain `host` header,
 * then whatever the request claimed.
 *
 * ## Why trusting these headers is safe *here* and not everywhere
 *
 * `x-forwarded-host` is client-controlled unless a proxy overwrites it, so
 * trusting it can become host-header injection — a poisoned password-reset link,
 * say. It cannot do that in this file: the value only ever becomes a
 * `redirect_uri`, and GitHub rejects any redirect_uri that is not registered on
 * the app. A forged host produces a failed sign-in, not a redirect anywhere
 * useful to the forger. Set `PUBLIC_ORIGIN` on the deploy and even that stops
 * being reachable.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, "")
  if (configured) return configured

  const url = new URL(request.url)
  // A proxy chain reports the client hop first.
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim()
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host")?.trim()

  if (!host) return url.origin
  return `${proto || url.protocol.replace(":", "")}://${host}`
}

/**
 * Read the session out of a request's cookies.
 *
 * `now` is passed through rather than left to `readSession`'s default so a test
 * can mint and read at the same instant. Without it a test that fixes the issue
 * time reads back with the real clock, and every assertion passes or fails on
 * expiry instead of on the thing it meant to check.
 */
export function sessionFromRequest(
  request: Request,
  secret: string | undefined,
  now = Date.now(),
): Session | null {
  const header = request.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === SESSION_COOKIE) {
      return readSession(decodeURIComponent(rest.join("=")), secret, now)
    }
  }
  return null
}
