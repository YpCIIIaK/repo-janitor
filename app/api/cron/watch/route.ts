import { NextResponse } from "next/server"
import { bearerToken, safeEqual } from "@/lib/api-auth"
import { limitsFromEnv, withScanSlot } from "@/lib/scan-limits"
import { sendMail } from "@/lib/mail"
import { buildDropDigest } from "@/lib/watch-email"
import { isSignificantDrop } from "@/lib/watch-drop"
import { scanWatchedRepo } from "@/lib/watch-scan"
import { listDueWatches, updateWatchCheckpoint } from "@/lib/watch-store"
import { isPublicGitUrl } from "@/lib/url-guard"

/**
 * Server cron: rescan due watches, email on significant drop.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` or `?secret=` (cron-job.org).
 * Unset CRON_SECRET → 503 (fail closed; this endpoint spends real CPU).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function cronBatch(): number {
  const n = Number.parseInt(process.env.WATCH_CRON_BATCH ?? "", 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10) : 3
}

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim()
  if (!expected) return false
  const bearer = bearerToken(request)
  if (bearer && safeEqual(bearer, expected)) return true
  const q = new URL(request.url).searchParams.get("secret") ?? ""
  return q.length > 0 && safeEqual(q, expected)
}

function absolute(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

async function runCron(request: Request) {
  if (!authorized(request)) {
    const configured = Boolean(process.env.CRON_SECRET?.trim())
    return NextResponse.json(
      {
        error: configured ? "Unauthorized" : "CRON_SECRET is not set",
      },
      { status: configured ? 401 : 503 },
    )
  }

  const origin =
    process.env.REPO_ANTI_ROT_DASHBOARD_URL?.trim().replace(/\/$/, "") ||
    new URL(request.url).origin

  const batch = cronBatch()
  const due = await listDueWatches(batch)
  const limits = limitsFromEnv()
  const results: {
    id: string
    repo: string
    ok: boolean
    dropped?: boolean
    mailed?: boolean
    error?: string
  }[] = []

  for (const sub of due) {
    const repo = `${sub.owner}/${sub.name}`
    const urlOk = await isPublicGitUrl(sub.repoUrl)
    if (!urlOk.ok) {
      await updateWatchCheckpoint(sub.id, {
        lastGrade: sub.lastGrade,
        lastScore: sub.lastScore,
        lastSha: sub.lastSha,
        lastCheckedAt: new Date().toISOString(),
      })
      results.push({ id: sub.id, repo, ok: false, error: urlOk.reason })
      continue
    }

    try {
      const scan = await withScanSlot(limits, () =>
        scanWatchedRepo(sub.repoUrl, sub.lastSha),
      )
      const checkedAt = new Date().toISOString()

      if (!scan.ok) {
        await updateWatchCheckpoint(sub.id, {
          lastGrade: sub.lastGrade,
          lastScore: sub.lastScore,
          lastSha: sub.lastSha,
          lastCheckedAt: checkedAt,
        })
        results.push({ id: sub.id, repo, ok: false, error: scan.error })
        continue
      }

      const verdict = isSignificantDrop(
        { grade: sub.lastGrade, score: sub.lastScore },
        { grade: scan.grade, score: scan.score },
      )

      let mailed = false
      if (verdict.dropped) {
        const mail = buildDropDigest({
          owner: sub.owner,
          name: sub.name,
          prevGrade: sub.lastGrade,
          prevScore: sub.lastScore,
          nextGrade: scan.grade,
          nextScore: scan.score,
          critical: scan.critical,
          warning: scan.warning,
          commits: scan.commits,
          scanUrl: absolute(origin, `/?url=${encodeURIComponent(sub.repoUrl)}`),
          manageUrl: absolute(origin, `/watch/${sub.manageToken}`),
          unsubUrl: absolute(
            origin,
            `/api/watch?token=${encodeURIComponent(sub.unsubToken)}`,
          ),
        })
        const sent = await sendMail({ to: sub.email, ...mail })
        mailed = sent.ok
      }

      await updateWatchCheckpoint(sub.id, {
        lastGrade: scan.grade,
        lastScore: scan.score,
        lastSha: scan.sha,
        lastCheckedAt: checkedAt,
        lastNotifiedAt: mailed ? checkedAt : undefined,
      })

      results.push({
        id: sub.id,
        repo,
        ok: true,
        dropped: verdict.dropped,
        mailed,
      })
    } catch (err) {
      results.push({
        id: sub.id,
        repo,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    checked: results.length,
    results,
  })
}

export async function POST(request: Request) {
  return runCron(request)
}

/** GET for simple uptime cron services that only GET. */
export async function GET(request: Request) {
  return runCron(request)
}
