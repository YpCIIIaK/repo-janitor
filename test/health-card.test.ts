import { describe, it, expect } from "vitest"
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardHeadline,
  cardSurface,
  compactCount,
  compactScope,
  formatCardFoot,
  renderHealthCardSvg,
  truncateLabel,
  type HealthCardData,
} from "@/lib/health-card"
import { cardMarkdown, cardUrl } from "@/lib/badge-markdown"
import { hashSeed, hslToHex, parseHex } from "@/lib/badge-decor"

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

  it("prefers a rot hint over the scanned date", () => {
    const foot = formatCardFoot(
      "385 files · 43,591 lines",
      "2026-08-01T12:00:00.000Z",
      52,
      "Last improved 47d ago",
    )
    expect(foot).toContain("Last improved 47d ago")
    expect(foot).not.toContain("Scanned")
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

  it("shows the rot hint in the footer when provided", () => {
    const svg = renderHealthCardSvg("acme", "widget", {
      ...sample,
      rotHint: "Rotting 12d",
    })
    expect(svg).toContain("Rotting 12d")
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

describe("cardSurface", () => {
  /**
   * Hue identifies the repository, saturation reports its health. The card used
   * to be a flat background under a 160px band of grade colour, which left a
   * seam a third of the way across and gave every project the same surface.
   */

  it("gives different repositories different hues", () => {
    const a = cardSurface(hashSeed("alpha/nebula"), "A", "dark")
    const b = cardSurface(hashSeed("beta/harbor"), "A", "dark")
    expect(a.bg0).not.toBe(b.bg0)
  })

  it("gives one repository the same surface every time", () => {
    const seed = hashSeed("alpha/nebula")
    expect(cardSurface(seed, "B", "dark")).toEqual(cardSurface(seed, "B", "dark"))
  })

  it("drains the colour as the grade falls", () => {
    // Saturation carries the grade, so it must decrease monotonically. This is a
    // second encoding, never the only one — the letter, the accent bar and the
    // chips all still state the grade outright.
    const seed = hashSeed("alpha/nebula")
    const sat = (hex: string) => {
      const c = parseHex(hex)!
      const max = Math.max(c.r, c.g, c.b)
      const min = Math.min(c.r, c.g, c.b)
      return max === 0 ? 0 : (max - min) / max
    }
    const grades = ["A", "B", "C", "D", "F"] as const
    const sats = grades.map((g) => sat(cardSurface(seed, g, "dark").bg0))
    for (let i = 1; i < sats.length; i++) {
      expect(sats[i]).toBeLessThan(sats[i - 1])
    }
  })

  it("keeps a dark card dark and a light card light", () => {
    // Whatever hue comes out of the seed, the surface has to stay a background:
    // a mid-tone would take the text down with it.
    const lum = (hex: string) => {
      const c = parseHex(hex)!
      return (c.r + c.g + c.b) / 3 / 255
    }
    for (const id of ["alpha/nebula", "gamma/drift", "omega/relic", "a/b"]) {
      for (const g of ["A", "F"] as const) {
        expect(lum(cardSurface(hashSeed(id), g, "dark").bg0)).toBeLessThan(0.2)
        expect(lum(cardSurface(hashSeed(id), g, "light").bg0)).toBeGreaterThan(0.9)
      }
    }
  })

  it("uses a near-neutral surface when there is no grade to report", () => {
    const s = cardSurface(hashSeed("nobody/nothing"), null, "dark")
    const c = parseHex(s.bg0)!
    expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(12)
  })
})

describe("hslToHex", () => {
  it("matches known conversions", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000")
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00")
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff")
    expect(hslToHex(0, 0, 0.5)).toBe("#808080")
  })

  it("wraps hue and clamps out-of-range input", () => {
    expect(hslToHex(360, 1, 0.5)).toBe(hslToHex(0, 1, 0.5))
    expect(hslToHex(-120, 1, 0.5)).toBe(hslToHex(240, 1, 0.5))
    expect(hslToHex(0, 5, 2)).toBe("#ffffff")
  })
})
