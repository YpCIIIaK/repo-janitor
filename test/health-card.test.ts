import { describe, it, expect } from "vitest"
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardHeadline,
  compactCount,
  compactScope,
  formatCardFoot,
  renderHealthCardSvg,
  truncateLabel,
  type HealthCardData,
} from "@/lib/health-card"
import { cardMarkdown, cardUrl } from "@/lib/badge-markdown"

const sample: HealthCardData = {
  owner: "acme",
  name: "widget",
  grade: "A",
  score: 94,
  counts: { critical: 0, warning: 0, info: 2 },
  totalIssues: 2,
  generatedAt: "2026-07-27T10:00:00.000Z",
  scope: "1,240 files · 182,431 lines",
}

describe("cardHeadline", () => {
  it("celebrates a clean scan", () => {
    expect(
      cardHeadline({ counts: { critical: 0, warning: 0, info: 0 }, totalIssues: 0, score: 100 }),
    ).toMatch(/clean/i)
  })

  it("does not celebrate a critical finding", () => {
    expect(
      cardHeadline({ counts: { critical: 1, warning: 0, info: 0 }, totalIssues: 1, score: 80 }),
    ).toBe("1 finding")
  })
})

describe("truncateLabel", () => {
  it("leaves short labels alone", () => {
    expect(truncateLabel("acme/widget")).toBe("acme/widget")
  })

  it("ellipsis long labels", () => {
    const long = "a".repeat(50)
    expect(truncateLabel(long, 10)).toBe(`${"a".repeat(9)}…`)
  })
})

describe("compact meta line", () => {
  it("compacts large counts", () => {
    expect(compactCount(385)).toBe("385")
    expect(compactCount(43591)).toBe("44k")
    expect(compactCount(182431)).toBe("182k")
  })

  it("compacts a scopeLine string", () => {
    expect(compactScope("385 files · 43,591 lines")).toBe("385 files · 44k lines")
  })

  it("builds a short foot that fits the plaque", () => {
    const foot = formatCardFoot("385 files · 43,591 lines", "2026-08-01T12:00:00.000Z", 52)
    expect(foot).toContain("44k")
    expect(foot).toContain("Scanned")
    expect(foot.length).toBeLessThanOrEqual(52)
  })
})

describe("renderHealthCardSvg", () => {
  it("renders a known report with grade and score", () => {
    const svg = renderHealthCardSvg("acme", "widget", sample)
    expect(svg).toContain(`width="${CARD_WIDTH}"`)
    expect(svg).toContain(`height="${CARD_HEIGHT}"`)
    expect(svg).toContain(">A<")
    expect(svg).toContain("94")
    expect(svg).toContain("acme/widget")
    expect(svg).toContain("0 critical")
    expect(svg.startsWith("<?xml")).toBe(true)
    // Meta line uses compact counts so it does not collide with chips.
    expect(svg).toContain("182k")
    // Chips sit above the footer band (chip translate Y < footer text Y).
    const chipY = Number(svg.match(/translate\(28,(\d+)\)/)?.[1])
    const footY = Number(svg.match(/y="(\d+)" fill="#6e7681"[^>]*>[^<]*Scanned/)?.[1])
    expect(chipY).toBeGreaterThan(0)
    expect(footY).toBeGreaterThan(chipY + 26)
  })

  it("never shows another repo's grade under this path", () => {
    // The path wins the title; data.owner is ignored for display identity.
    const svg = renderHealthCardSvg("other", "repo", { ...sample, owner: "acme", name: "widget" })
    expect(svg).toContain("other/repo")
    expect(svg).not.toContain("acme/widget")
  })

  it("renders a neutral unknown card", () => {
    const svg = renderHealthCardSvg("acme", "widget", null)
    expect(svg).toContain("unknown")
    expect(svg).toContain("acme/widget")
    expect(svg).not.toMatch(/>A</)
  })

  it("escapes markup in the repository name", () => {
    const svg = renderHealthCardSvg("acme", "<script>", sample)
    expect(svg).toContain("acme/&lt;script&gt;")
    expect(svg).not.toContain("acme/<script>")
  })
})

describe("card markdown helpers", () => {
  const ORIGIN = "https://anti-rot.example.com"

  it("builds a card URL with the share token", () => {
    expect(cardUrl(ORIGIN, { owner: "acme", name: "widget", token: "tok123" })).toBe(
      `${ORIGIN}/api/card/acme/widget?token=tok123`,
    )
  })

  it("builds markdown linking the card to the shared report", () => {
    expect(cardMarkdown(ORIGIN, `${ORIGIN}/r/acme/widget/tok123`)).toBe(
      `[![Repo Anti-Rot](${ORIGIN}/api/card/acme/widget?token=tok123)](${ORIGIN}/r/acme/widget/tok123)`,
    )
  })
})
