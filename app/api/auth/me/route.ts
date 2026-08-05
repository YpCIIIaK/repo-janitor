import { oauthConfig } from "@/lib/github-oauth"
import { sessionFromRequest } from "@/lib/session"

/**
 * Who the caller is, as far as the cookie says.
 *
 * `{ login: null }` rather than a 401 for a signed-out visitor: not being signed
 * in is the normal state of this service, not an error, and a client polling
 * this should not have to treat it as one.
 *
 * `configured` lets the UI tell "sign-in is off on this deploy" apart from
 * "you are signed out", which are the same thing to a visitor and completely
 * different things to whoever set the deploy up.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = sessionFromRequest(request, process.env.REPO_ANTI_ROT_SESSION_SECRET)

  return Response.json(
    {
      login: session?.login ?? null,
      expiresAt: session ? new Date(session.exp * 1000).toISOString() : null,
      configured: Boolean(oauthConfig() && process.env.REPO_ANTI_ROT_SESSION_SECRET),
    },
    // Never cached: a shared cache holding one visitor's identity and handing it
    // to the next is the worst possible bug in this file.
    { headers: { "Cache-Control": "no-store" } },
  )
}
