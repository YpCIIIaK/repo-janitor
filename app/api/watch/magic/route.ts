import { NextResponse } from "next/server"
import { clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { sendMail } from "@/lib/mail"
import { buildMagicLinkMail } from "@/lib/watch-email"
import { allowRate } from "@/lib/watch-rate"
import { findManageTokenForEmail, listWatchesByManageToken } from "@/lib/watch-store"
import { normalizeWatchEmail } from "@/lib/watch-tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Magic link: email a capability URL for "my watches".
 *
 * Always returns the same success shape whether or not the address has watches —
 * so the endpoint cannot be used to probe who is subscribed.
 */
export async function POST(request: Request) {
  const limits = limitsFromEnv()
  const ip = clientIp(request, limits.trustedProxyHops)
  if (!allowRate(`watch:magic:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try later." }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email = normalizeWatchEmail(body.email)
  if (!email) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 })
  }

  const origin =
    process.env.REPO_ANTI_ROT_DASHBOARD_URL?.trim().replace(/\/$/, "") ||
    new URL(request.url).origin

  const manageToken = await findManageTokenForEmail(email)
  if (manageToken) {
    const watches = await listWatchesByManageToken(manageToken)
    if (watches.length > 0) {
      const manageUrl = `${origin}/watch/${manageToken}`
      const mail = buildMagicLinkMail({ manageUrl, count: watches.length })
      void sendMail({ to: email, ...mail })
    }
  }

  return NextResponse.json({ ok: true })
}
