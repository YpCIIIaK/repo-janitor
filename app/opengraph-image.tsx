import { ImageResponse } from "next/og"
import { OG_SIZE, OgMark } from "@/components/repo-anti-rot/og-report-image"

/** Site-wide link preview: the mark, the name and what it does. */
export const alt = "Repo Janitor — repository maintenance, prioritized"
export const size = OG_SIZE
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#e2e8f0",
          padding: 96,
          fontFamily: "sans-serif",
        }}
      >
        <OgMark size={140} />
        <div style={{ fontSize: 84, fontWeight: 700, marginTop: 48 }}>Repo Janitor</div>
        <div style={{ fontSize: 38, color: "#94a3b8", marginTop: 16 }}>
          Repository maintenance, prioritized.
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 26, color: "#f97316" }}>
          Secrets · vulnerable deps · stale code · broken docs — graded A to F
        </div>
      </div>
    ),
    OG_SIZE,
  )
}
