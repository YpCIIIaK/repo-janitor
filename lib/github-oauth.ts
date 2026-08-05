import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * GitHub OAuth — the pure half.
 *
 * No fetching here, so the URL building, the CSRF state and the token-response
 * shaping can all be tested without a network or a real OAuth app.
 *
 * ## This is not the same credential as GITHUB_TOKEN
 *
 * `GITHUB_TOKEN` is a scopeless personal access token the server uses to read
 * public data at a decent rate limit. It cannot sign anyone in — it identifies
 * the server, not a visitor. Signing in needs an OAuth App, which is a separate
 * thing with its own client id and secret, and it is what makes GitHub show the
 * "authorize" screen and then tell us who came back.
 *
 * ## Scopes
 *
 * None. An empty scope still yields a token that can read public profile data,
 * which is all the profile page shows, and it means a leaked token grants
 * nothing that was not already public. Ask for `read:user` only when something
 * actually needs a private field, and expect to explain why on the consent
 * screen — GitHub shows the user exactly what was requested.
 */

export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
export const TOKEN_URL = "https://github.com/login/oauth/access_token"

/**
 * How long a sign-in attempt may sit half-finished.
 *
 * The state cookie is the CSRF defence, and it is only useful while it is
 * unpredictable and fresh. Ten minutes covers "I got distracted on the GitHub
 * authorize screen" and not much more.
 */
export const STATE_TTL_SECONDS = 600

export const STATE_COOKIE = "rar_oauth_state"

export interface OAuthConfig {
  clientId: string
  clientSecret: string
}

/** Reads the OAuth app credentials, or null when the deploy has none. */
export function oauthConfig(
  env: Record<string, string | undefined> = process.env,
): OAuthConfig | null {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim()
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * A signed state value: `nonce.expiry.signature`.
 *
 * Signed rather than merely random so the callback can validate it without
 * anywhere to have written the nonce down — same reasoning as the session
 * itself. The cookie still has to match, because a signed value an attacker can
 * obtain by starting their own sign-in is not on its own proof of anything.
 */
export function createState(secret: string, now = Date.now()): string {
  const nonce = randomBytes(16).toString("base64url")
  const exp = Math.floor(now / 1000) + STATE_TTL_SECONDS
  const body = `${nonce}.${exp}`
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`
}

/** True when `state` is well-formed, correctly signed and not expired. */
export function verifyState(state: string, secret: string, now = Date.now()): boolean {
  if (!state || !secret) return false

  const parts = state.split(".")
  if (parts.length !== 3) return false

  const [nonce, expRaw, signature] = parts
  const expected = createHmac("sha256", secret).update(`${nonce}.${expRaw}`).digest("base64url")

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  const exp = Number(expRaw)
  return Number.isFinite(exp) && exp > Math.floor(now / 1000)
}

/**
 * Compare the state from the query string with the one from the cookie.
 *
 * Both checks are needed and neither is redundant. The signature proves we
 * minted it; the cookie proves it was minted for *this* browser. Skip the
 * second and anyone can start a sign-in, harvest a valid state, and use it to
 * complete a login flow in somebody else's browser.
 */
export function statesMatch(fromQuery: string | null, fromCookie: string | null): boolean {
  if (!fromQuery || !fromCookie) return false
  const a = Buffer.from(fromQuery)
  const b = Buffer.from(fromCookie)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Where to send the browser to start the flow. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    // Empty on purpose — see the scope note at the top of this file.
    scope: "",
    allow_signup: "true",
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Pull the access token out of GitHub's token response.
 *
 * GitHub answers a failed exchange with HTTP 200 and an `error` field rather
 * than a status code, so a caller checking only `res.ok` would sail past a
 * refusal and try to use the word "undefined" as a token.
 */
export function accessTokenFrom(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null
  const body = raw as Record<string, unknown>
  if (typeof body.error === "string") return null
  const token = body.access_token
  return typeof token === "string" && token ? token : null
}

/**
 * Where to send somebody after signing in.
 *
 * Only same-origin paths survive. The `next` parameter is attacker-controlled,
 * and handing it to a redirect unchecked is the classic open-redirect: a link
 * that starts on your domain, shows your consent screen, and lands on theirs.
 * Protocol-relative `//evil.test` is the case a naive `startsWith("/")` misses.
 */
export function safeReturnPath(next: string | null | undefined): string {
  if (!next) return "/profile"
  if (!next.startsWith("/")) return "/profile"
  if (next.startsWith("//")) return "/profile"
  if (next.includes("\\")) return "/profile"
  return next
}
