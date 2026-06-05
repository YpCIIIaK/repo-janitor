import "server-only"
import type { ScanReport } from "@/lib/server-store"

/**
 * Score-drop webhook (opt-in, server-side).
 *
 * When a freshly ingested report scores lower than the repo's previous report,
 * POST a short message to `RAR_WEBHOOK_URL`. The body is Slack/Discord-compatible
 * (`{ "text": "…" }`), which most custom receivers also accept.
 *
 * Config (env):
 *  - `RAR_WEBHOOK_URL`      — destination; unset → feature off (no-op).
 *  - `RAR_WEBHOOK_MIN_DROP` — minimum score drop to alert on (default 1, i.e.
 *                             any drop). Raise it to avoid noise from tiny dips.
 *  - `RAR_DASHBOARD_URL`    — optional; appended as a link if set.
 *
 * Best-effort: never throws and never blocks ingestion on failure.
 */

const TIMEOUT_MS = 5_000

function countCritical(report: ScanReport): number {
  return report.issues.filter((i) => i.severity === "critical").length
}

/** Build the alert text for a score drop. */
function buildMessage(previous: ScanReport, report: ScanReport): string {
  const slug = `${report.repo.owner}/${report.repo.name}`
  const drop = previous.score - report.score
  const newCriticals = countCritical(report) - countCritical(previous)
  const parts = [
    `🔴 ${slug} health dropped: ${previous.grade} (${previous.score}) → ${report.grade} (${report.score}), −${drop}.`,
  ]
  if (newCriticals > 0) parts.push(`+${newCriticals} new critical${newCriticals === 1 ? "" : "s"}.`)
  const dash = process.env.RAR_DASHBOARD_URL?.replace(/\/+$/, "")
  if (dash) parts.push(dash)
  return parts.join(" ")
}

/**
 * Notify the configured webhook if the score dropped by at least the threshold.
 * No-op when the webhook is unconfigured, on first ingest (nothing to compare),
 * or when the score held/improved.
 */
export async function notifyScoreDrop(previous: ScanReport | null, report: ScanReport): Promise<void> {
  const url = process.env.RAR_WEBHOOK_URL
  if (!url || !previous) return

  const minDrop = Math.max(1, parseInt(process.env.RAR_WEBHOOK_MIN_DROP ?? "1", 10) || 1)
  const drop = previous.score - report.score
  if (drop < minDrop) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: buildMessage(previous, report) }),
      signal: controller.signal,
    })
  } catch {
    // best-effort: a failed alert must never fail the ingest
  } finally {
    clearTimeout(timer)
  }
}
