import "server-only"
import type { ScanReport } from "@/lib/server-store"
import { readEnv } from "@/lib/env"
import type { Grade } from "@/lib/mock-data"

/**
 * Score-drop webhook (opt-in, server-side).
 *
 * When a freshly ingested report scores lower than the repo's previous report,
 * POST a short message to the configured URL. The body is Slack/Discord-compatible
 * (`{ "text": "…" }`), which most custom receivers also accept.
 *
 * Also used from `/api/notify-drop` after a browser rescan (same env).
 *
 * Config (env; the older `RAR_*` spellings still work — see `lib/env.ts`):
 *  - `REPO_ANTI_ROT_WEBHOOK_URL`      — destination; unset → feature off (no-op).
 *  - `REPO_ANTI_ROT_WEBHOOK_MIN_DROP` — minimum score drop to alert on (default 1,
 *                                       i.e. any drop). Raise it to cut noise.
 *  - `REPO_ANTI_ROT_DASHBOARD_URL`    — optional; appended as a link if set.
 *
 * Best-effort: never throws and never blocks ingestion on failure.
 */

const TIMEOUT_MS = 5_000

export type ScoreDropSummary = {
  owner: string
  name: string
  grade: Grade
  score: number
  critical: number
}

function countCritical(report: ScanReport): number {
  return report.issues.filter((i) => i.severity === "critical").length
}

/** Build the alert text for a score drop. */
export function buildDropMessage(previous: ScoreDropSummary, current: ScoreDropSummary): string {
  const slug = `${current.owner}/${current.name}`
  const drop = previous.score - current.score
  const newCriticals = current.critical - previous.critical
  const parts = [
    `🔴 ${slug} health dropped: ${previous.grade} (${previous.score}) → ${current.grade} (${current.score}), −${drop}.`,
  ]
  if (newCriticals > 0) parts.push(`+${newCriticals} new critical${newCriticals === 1 ? "" : "s"}.`)
  const dash = readEnv("REPO_ANTI_ROT_DASHBOARD_URL")?.replace(/\/+$/, "")
  if (dash) parts.push(dash)
  return parts.join(" ")
}

async function postWebhook(text: string): Promise<void> {
  const url = readEnv("REPO_ANTI_ROT_WEBHOOK_URL")
  if (!url) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
  } catch {
    // best-effort: a failed alert must never fail the caller
  } finally {
    clearTimeout(timer)
  }
}

function minDrop(): number {
  return Math.max(1, parseInt(readEnv("REPO_ANTI_ROT_WEBHOOK_MIN_DROP") ?? "1", 10) || 1)
}

/**
 * Notify from a lightweight summary (browser rescan path).
 */
export async function notifyScoreDropFromSummary(
  previous: ScoreDropSummary | null,
  current: ScoreDropSummary,
): Promise<void> {
  if (!previous) return
  const drop = previous.score - current.score
  if (drop < minDrop()) return
  await postWebhook(buildDropMessage(previous, current))
}

/**
 * Notify the configured webhook if the score dropped by at least the threshold.
 * No-op when the webhook is unconfigured, on first ingest (nothing to compare),
 * or when the score held/improved.
 */
export async function notifyScoreDrop(previous: ScanReport | null, report: ScanReport): Promise<void> {
  if (!previous) return
  await notifyScoreDropFromSummary(
    {
      owner: previous.repo.owner,
      name: previous.repo.name,
      grade: previous.grade,
      score: previous.score,
      critical: countCritical(previous),
    },
    {
      owner: report.repo.owner,
      name: report.repo.name,
      grade: report.grade,
      score: report.score,
      critical: countCritical(report),
    },
  )
}
