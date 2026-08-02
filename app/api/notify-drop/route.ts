import { NextResponse } from "next/server"
import { notifyScoreDropFromSummary } from "@/lib/webhook"
import { clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { allowRate } from "@/lib/watch-rate"
import { isGrade } from "@/lib/watch-drop"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Browser rescan → score-drop webhook.
 *
 * Ingest already fires {@link notifyScoreDrop} from CI. Client rescans never hit
 * ingest, so the dashboard POSTs a tiny summary here after a local rescan when
 * the score fell. Same env as ingest (`REPO_ANTI_ROT_WEBHOOK_URL`). Rate-limited.
 */
export async function POST(request: Request) {
  const limits = limitsFromEnv()
  const ip = clientIp(request, limits.trustedProxyHops)
  if (!allowRate(`notify-drop:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
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
