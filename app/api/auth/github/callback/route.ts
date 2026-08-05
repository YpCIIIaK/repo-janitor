import {
  STATE_COOKIE,
  TOKEN_URL,
  accessTokenFrom,
  oauthConfig,
  safeReturnPath,
  statesMatch,
  verifyState,
} from "@/lib/github-oauth"
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  isSecureRequest,
  publicOrigin,
} from "@/lib/session"
import { isGithubLogin } from "@/lib/hunter"

/**
 * Where GitHub sends the browser back.
 *
 * Exchanges the code for a token, asks GitHub who the token belongs to, and
 * mints a signed session cookie for that login. The token itself is used once
 * and dropped — nothing needs it afterwards, and a stored token is a stored
 * credential with all the duties that implies.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TIMEOUT_MS = 6000

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

/** Clears the short-lived flow cookies whichever way the callback ends. */
function clearFlowCookies(headers: Headers, secure: string) {
  headers.append("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`)
  headers.append("Set-Cookie", `rar_oauth_next=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`)
}

function fail(request: Request, reason: string) {
  const headers = new Headers({ Location: `/profile?error=${encodeURIComponent(reason)}` })
  clearFlowCookies(headers, isSecureRequest(request) ? "; Secure" : "")
  return new Response(null, { status: 302, headers })
}

async function exchangeCode(code: string, redirectUri: string, clientId: string, clientSecret: string) {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // GitHub answers a rejected exchange with 200 and an `error` field, so the
    // status alone does not say whether this worked.
    return accessTokenFrom(await res.json())
  } catch {
    return null
  }
}

async function loginFor(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "repo-anti-rot-auth",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { login?: unknown }
    // Validated even though it came from GitHub: this string ends up in a
    // session and then in URLs, and trusting a remote field's shape because of
    // where it came from is how injection bugs start.
    return isGithubLogin(body.login) ? body.login : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const config = oauthConfig()
  const secret = process.env.REPO_ANTI_ROT_SESSION_SECRET
  if (!config || !secret) {
    return new Response("GitHub sign-in is not configured on this deploy", { status: 503 })
  }

  const url = new URL(request.url)

  // The user pressed "cancel" on GitHub's authorize screen. Not an error worth
  // a scary message — just come back signed out.
  if (url.searchParams.get("error")) return fail(request, "cancelled")

  const state = url.searchParams.get("state")
  const stateCookie = cookie(request, STATE_COOKIE)

  // Both checks: the signature proves we minted it, the cookie proves it was
  // minted for this browser.
  if (!statesMatch(state, stateCookie) || !verifyState(state ?? "", secret)) {
    return fail(request, "bad_state")
  }

  const code = url.searchParams.get("code")
  if (!code) return fail(request, "no_code")

  const token = await exchangeCode(
    code,
    // Must be byte-identical to the one sent when the flow started.
    `${publicOrigin(request)}/api/auth/github/callback`,
    config.clientId,
    config.clientSecret,
  )
  if (!token) return fail(request, "exchange_failed")

  const login = await loginFor(token)
  if (!login) return fail(request, "who_failed")

  const next = safeReturnPath(cookie(request, "rar_oauth_next"))
  const secure = isSecureRequest(request) ? "; Secure" : ""
  const headers = new Headers({ Location: next })
  clearFlowCookies(headers, secure)
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${createSession(login, secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  )

  return new Response(null, { status: 302, headers })
}
