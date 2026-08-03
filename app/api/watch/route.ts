import { NextResponse } from "next/server"
import { clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { isPublicGitUrl } from "@/lib/url-guard"
import { isGrade } from "@/lib/watch-drop"
import { sendMail } from "@/lib/mail"
import { buildWelcomeWatch } from "@/lib/watch-email"
import { allowRate } from "@/lib/watch-rate"
import { subscribeWatch, unsubscribeByToken } from "@/lib/watch-store"
import { isValidWatchToken, normalizeWatchEmail } from "@/lib/watch-tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function absoluteUrl(request: Request, path: string): string {
  const base =
    process.env.REPO_ANTI_ROT_DASHBOARD_URL?.trim().replace(/\/$/, "") ||
    new URL(request.url).origin
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * POST — subscribe to drop alerts for a public repo.
 * DELETE — unsubscribe via unsub token (body or ?token=).
 */
export async function POST(request: Request) {
  const limits = limitsFromEnv()
  const ip = clientIp(request, limits.trustedProxyHops)
  if (!allowRate(`watch:sub:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many watch requests. Try later." }, { status: 429 })
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

  const owner = typeof body.owner === "string" ? body.owner.trim() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!owner || !name || owner.length > 100 || name.length > 100) {
    return NextResponse.json({ error: "owner and name required" }, { status: 400 })
  }

  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : ""
  if (!repoUrl) {
    return NextResponse.json({ error: "repoUrl required" }, { status: 400 })
  }
  const urlCheck = await isPublicGitUrl(repoUrl)
  if (!urlCheck.ok) {
    return NextResponse.json({ error: `Unsafe repo URL: ${urlCheck.reason}` }, { status: 400 })
  }

  const gradeRaw = typeof body.grade === "string" ? body.grade : ""
  if (!isGrade(gradeRaw)) {
    return NextResponse.json({ error: "grade must be A–F" }, { status: 400 })
  }
  const score = typeof body.score === "number" ? body.score : Number(body.score)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return NextResponse.json({ error: "score must be 0–100" }, { status: 400 })
  }
  const sha = typeof body.sha === "string" && /^[0-9a-f]{7,40}$/i.test(body.sha) ? body.sha : null
  const issueIds = Array.isArray(body.issueIds)
    ? body.issueIds.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 500)
    : undefined

  try {
    const result = await subscribeWatch({
      email,
      owner,
      name,
      repoUrl,
      grade: gradeRaw,
      score: Math.round(score),
      sha,
      issueIds,
    })

    const manageUrl = absoluteUrl(request, result.managePath)
    const unsubUrl = absoluteUrl(
      request,
      `/api/watch?token=${encodeURIComponent(result.subscription.unsubToken)}`,
    )

    if (result.created) {
      const mail = buildWelcomeWatch({
        owner,
        name,
        grade: gradeRaw,
        score: Math.round(score),
        manageUrl,
        unsubUrl,
      })
      void sendMail({ to: email, ...mail })
    }

    return NextResponse.json({
      ok: true,
      created: result.created,
      managePath: result.managePath,
      manageUrl,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "subscribe failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  let token = searchParams.get("token") ?? ""
  if (!token) {
    try {
      const body = (await request.json()) as { unsubToken?: string; token?: string }
      token = body.unsubToken ?? body.token ?? ""
    } catch {
      /* query-only */
    }
  }
  if (!isValidWatchToken(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 })
  }
  const ok = await unsubscribeByToken(token)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** GET with ?token= also unsubscribes — one-click from email clients. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!isValidWatchToken(token)) {
    return NextResponse.redirect(new URL("/?unsubscribed=0", request.url))
  }
  const ok = await unsubscribeByToken(token)
  return NextResponse.redirect(new URL(ok ? "/?unsubscribed=1" : "/?unsubscribed=0", request.url))
}
