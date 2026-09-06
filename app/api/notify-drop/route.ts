import { NextResponse } from "next/server"
import { notifyScoreDropFromSummary } from "@/lib/webhook"
import { clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { allowRate } from "@/lib/watch-rate"
import { isGrade } from "@/lib/watch-drop"
import { isOwner } from "@/lib/owner"
import { readEnv } from "@/lib/env"
import { readJson } from "@/lib/request-json"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Browser rescan → score-drop webhook.
 *
 * Ingest already fires {@link notifyScoreDrop} from CI. Client rescans never hit
 * ingest, so the dashboard POSTs a tiny summary here after a local rescan when
 * the score fell. Same env as ingest (`REPO_ANTI_ROT_WEBHOOK_URL`). Rate-limited.
 *
 * ## Who may ring the bell
 *
 * The body is whatever the browser says happened — there is no report behind
 * it to check. On a private dashboard that is fine: the only browser is the
 * operator's. On a public instance it is an open door to the operator's Slack:
 * anyone can POST "acme/widget dropped A → F" thirty times an hour, forever.
 * So in public mode the request must carry the owner cookie; everyone else gets
 * a 204 and nothing is sent. The response never distinguishes "not configured"
 * from "not you" — neither is the caller's business.
 */
export async function POST(request: Request) {
  const limits = limitsFromEnv()
  const ip = clientIp(request, limits.trustedProxyHops)
  if (!allowRate(`notify-drop:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  // Nothing to deliver to, or not the operator on a public box: accept quietly.
  // The browser fires this in the background and ignores the answer anyway.
  const configured = Boolean(readEnv("REPO_ANTI_ROT_WEBHOOK_URL")?.trim())
  const allowed = process.env.REPO_ANTI_ROT_PUBLIC !== "true" || isOwner(request)
  if (!configured || !allowed) {
    return new Response(null, { status: 204 })
  }

  let body: Record<string, unknown>
  try {
    body = (await readJson(request, 8 * 1024)) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid object")
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const owner = typeof body.owner === "string" ? body.owner.trim() : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!owner || !name) {
    return NextResponse.json({ error: "owner and name required" }, { status: 400 })
  }

  const prev = body.previous as Record<string, unknown> | undefined
  const next = body.current as Record<string, unknown> | undefined
  if (!prev || !next) {
    return NextResponse.json({ error: "previous and current required" }, { status: 400 })
  }

  const prevGrade = typeof prev.grade === "string" ? prev.grade : ""
  const nextGrade = typeof next.grade === "string" ? next.grade : ""
  if (!isGrade(prevGrade) || !isGrade(nextGrade)) {
    return NextResponse.json({ error: "grades must be A–F" }, { status: 400 })
  }
  const prevScore = Number(prev.score)
  const nextScore = Number(next.score)
  if (!Number.isFinite(prevScore) || !Number.isFinite(nextScore)) {
    return NextResponse.json({ error: "scores must be numbers" }, { status: 400 })
  }

  const prevCritical = Math.max(0, Number(prev.critical) || 0)
  const nextCritical = Math.max(0, Number(next.critical) || 0)

  await notifyScoreDropFromSummary(
    { owner, name, grade: prevGrade, score: Math.round(prevScore), critical: prevCritical },
    { owner, name, grade: nextGrade, score: Math.round(nextScore), critical: nextCritical },
  )

  return NextResponse.json({ ok: true })
}
