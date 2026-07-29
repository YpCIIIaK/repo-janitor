import { NextResponse } from "next/server"
import { OWNER_COOKIE, isOwner, isOwnerToken, ownerKeyConfigured } from "@/lib/owner"
import { checkRateLimit, clientIp, limitsFromEnv } from "@/lib/scan-limits"

/**
 * Claim (or drop) the operator key.
 *
 *   POST   { "token": "…" }   →  sets the owner cookie
 *   DELETE                    →  clears it
 *   GET                       →  am I the owner, and is a key even configured
 *
 * The cookie is `httpOnly`, so the key it carries is never readable from page
 * scripts. `sameSite: lax` keeps it off cross-site requests, which matters here:
 * without it another site could make your browser spend your unlimited quota.
 *
 * Attempts are rate-limited on the ordinary scan budget. This endpoint compares
 * a secret, so it is exactly the thing someone would sit and guess at, and a few
 * dozen tries an hour makes that pointless against any real key.
 */
export const runtime = "nodejs"

const MAX_AGE = 90 * 24 * 60 * 60

export async function GET(request: Request) {
  return NextResponse.json({ owner: isOwner(request), configured: ownerKeyConfigured() })
}

export async function POST(request: Request) {
  const limits = limitsFromEnv()
  if (!checkRateLimit(clientIp(request, limits.trustedProxyHops), limits).ok) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const token = String((body as { token?: unknown })?.token ?? "").trim()
  if (!isOwnerToken(token)) {
    // One message for "wrong key" and for "no key configured on this
    // deployment". Telling them apart would confirm to a guesser that there is
    // something here worth guessing at.
    return NextResponse.json({ error: "That key is not valid here." }, { status: 401 })
  }

  const res = NextResponse.json({ owner: true })
  res.cookies.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure everywhere but local http, where the cookie would otherwise be
    // dropped and the feature would look broken in development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ owner: false })
  res.cookies.set(OWNER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
