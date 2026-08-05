import {
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  authorizeUrl,
  createState,
  oauthConfig,
  safeReturnPath,
} from "@/lib/github-oauth"
import { isSecureRequest } from "@/lib/session"

/**
 * Starts the GitHub sign-in flow: mint a state, set it as a cookie, redirect.
 *
 * `?next=/somewhere` comes back to that path afterwards, validated as
 * same-origin — see `safeReturnPath`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const config = oauthConfig()
  const secret = process.env.REPO_ANTI_ROT_SESSION_SECRET

  // Fail loudly rather than bouncing the browser to GitHub with an empty client
  // id, which produces GitHub's own error page and looks like their fault.
  if (!config || !secret) {
    return new Response("GitHub sign-in is not configured on this deploy", { status: 503 })
  }

  const url = new URL(request.url)
  const next = safeReturnPath(url.searchParams.get("next"))
  const state = createState(secret)
  const redirectUri = `${url.origin}/api/auth/github/callback`

  const headers = new Headers({ Location: authorizeUrl(config.clientId, redirectUri, state) })
  const secure = isSecureRequest(request) ? "; Secure" : ""
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}${secure}`,
  )
  // Where to land afterwards, kept beside the state so the callback does not
  // have to trust anything in its own query string.
  headers.append(
    "Set-Cookie",
    `rar_oauth_next=${encodeURIComponent(next)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}${secure}`,
  )

  return new Response(null, { status: 302, headers })
}
