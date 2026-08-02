import { ImageResponse } from "next/og"
import { isBoastworthy, verdictOf, type VerdictCounts } from "@/lib/verdict"

/**
 * Link preview for a report page.
 *
 * The whole point of a shared link is that a grade shows up in someone's feed
 * without them clicking. A bare URL does not do that; a big letter does.
 *
 * Shared by both report routes so the token and tokenless previews cannot drift
 * apart — a preview that disagrees with the page it previews is worse than none.
 */

export const OG_SIZE = { width: 1200, height: 630 }

/** Grade → colour. Chosen for contrast on the dark card, not to match the app's theme tokens. */
const TONE: Record<string, string> = {
  A: "#34d399",
  B: "#a3e635",
  C: "#fbbf24",
  D: "#fb923c",
  F: "#f87171",
}

export interface OgReport {
  grade: string
  score: number
  totalIssues: number
  counts: VerdictCounts
}

export function renderReportOgImage(
  owner: string,
  name: string,
  report: OgReport | null,
) {
  // A missing report still needs an image — a broken preview is worse than a plain one.
  const grade = report?.grade ?? "?"
  const score = report?.score ?? 0
  const total = report?.totalIssues ?? 0
  const critical = report?.counts.critical ?? 0
  const tone = TONE[grade] ?? "#94a3b8"

  // In a feed nobody clicks, so the image has to carry the verdict itself.
  // "0 findings" is a number a reader has to interpret; "No critical findings"
  // is the thing they would have concluded, said once.
  const verdict = report ? verdictOf(report.counts, report.totalIssues, report.score) : "poor"
  const good = Boolean(report) && isBoastworthy(verdict)
  const headline = good
    ? verdict === "clean"
      ? "Clean scan — nothing found"
      : "No critical or warning findings"
    : `${total} findings`

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0f14",
          color: "#e2e8f0",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 28, color: "#94a3b8" }}>Repo Anti-Rot</div>
          {/* Satori requires an explicit `display` on any element with more than
              one child, so interpolations are joined into a single text node
              rather than sitting side by side. */}
          <div style={{ fontSize: 60, fontWeight: 700, marginTop: 12 }}>{`${owner}/${name}`}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 220,
              height: 220,
              borderRadius: 40,
              border: `6px solid ${tone}`,
              color: tone,
              fontSize: 140,
              fontWeight: 700,
            }}
          >
            {grade}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 72, fontWeight: 700 }}>{`${score}/100`}</div>
            <div style={{ fontSize: 32, color: good ? tone : "#94a3b8" }}>{headline}</div>
            {critical > 0 && (
              <div style={{ fontSize: 32, color: "#f87171" }}>{`${critical} critical`}</div>
            )}
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  )
}

