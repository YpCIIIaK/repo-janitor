import { describe, it, expect } from "vitest"
import {
  DEFAULT_WIDGET_OPTIONS,
  appendWidgetOptions,
  cardHeightFor,
  embedDimensions,
  formatBadgeMessage,
  parseWidgetOptions,
  widgetOptionsQuery,
} from "@/lib/widget-options"
import { badgeMarkdown, cardMarkdown, embedSnippet } from "@/lib/badge-markdown"
import { CARD_HEIGHT, renderHealthCardSvg, type HealthCardData } from "@/lib/health-card"

const ORIGIN = "https://anti-rot.example.com"
const SHARE = `${ORIGIN}/r/acme/widget/tok123`

const sample: HealthCardData = {
  owner: "acme",
  name: "widget",
  grade: "B",
  score: 77,
  counts: { critical: 0, warning: 1, info: 2 },
  totalIssues: 3,
  generatedAt: "2026-07-27T10:00:00.000Z",
  scope: "100 files · 10,000 lines",
}

describe("parseWidgetOptions", () => {
  it("defaults when the query is empty", () => {
    expect(parseWidgetOptions("")).toEqual(DEFAULT_WIDGET_OPTIONS)
  })

  it("reads theme, style, message, size, label and hide bands", () => {
    const opts = parseWidgetOptions(
      "theme=light&style=flat-square&message=grade&size=roomy&label=health&hide=chips,meta",
    )
    expect(opts).toMatchObject({
      theme: "light",
      style: "flat-square",
      message: "grade",
      size: "roomy",
      label: "health",
      chips: false,
      meta: false,
      headline: true,
    })
  })

  it("omits defaults from the serialized query", () => {
    expect(widgetOptionsQuery(DEFAULT_WIDGET_OPTIONS).toString()).toBe("")
  })

  it("serializes only non-defaults", () => {
    const q = widgetOptionsQuery({
      ...DEFAULT_WIDGET_OPTIONS,
      theme: "light",
      chips: false,
      message: "score",
    })
    expect(q.get("theme")).toBe("light")
    expect(q.get("message")).toBe("score")
    expect(q.get("hide")).toBe("chips")
    expect(q.get("style")).toBeNull()
  })
})

describe("formatBadgeMessage", () => {
  it("formats grade, score or both", () => {
    expect(formatBadgeMessage("A", 94, "grade-score")).toBe("A 94")
    expect(formatBadgeMessage("A", 94, "grade")).toBe("A")
    expect(formatBadgeMessage("A", 94, "score")).toBe("94")
  })
})

describe("dimensions", () => {
  it("grows the embed for roomy size", () => {
    expect(embedDimensions("compact").height).toBe(228)
    expect(embedDimensions("roomy").height).toBeGreaterThan(228)
  })

  it("shrinks the card when bands are hidden", () => {
    expect(cardHeightFor(DEFAULT_WIDGET_OPTIONS)).toBe(CARD_HEIGHT)
    expect(
      cardHeightFor({ chips: false, meta: false, headline: false }),
    ).toBeLessThan(CARD_HEIGHT)
  })
})

describe("URL helpers with options", () => {
  it("keeps default markdown URLs short", () => {
    expect(badgeMarkdown(ORIGIN, SHARE)).toBe(
      `[![Repo Anti-Rot](${ORIGIN}/api/badge/acme/widget?token=tok123)](${ORIGIN}/r/acme/widget/tok123)`,
    )
    expect(cardMarkdown(ORIGIN, SHARE)).toContain("?token=tok123")
    expect(cardMarkdown(ORIGIN, SHARE)).not.toContain("theme=")
  })

  it("appends widget options to badge, card and embed", () => {
    const opts = { ...DEFAULT_WIDGET_OPTIONS, theme: "light" as const, message: "grade" as const }
    expect(badgeMarkdown(ORIGIN, SHARE, opts)).toContain("theme=light")
    expect(badgeMarkdown(ORIGIN, SHARE, opts)).toContain("message=grade")
    expect(cardMarkdown(ORIGIN, SHARE, opts)).toContain("theme=light")
    const html = embedSnippet(ORIGIN, SHARE, { ...opts, size: "roomy" })
    expect(html).toContain("theme=light")
    expect(html).toContain("size=roomy")
    expect(html).toContain('height="268"')
  })

  it("appendWidgetOptions is a no-op for defaults", () => {
    expect(appendWidgetOptions("https://x/a?token=t", DEFAULT_WIDGET_OPTIONS)).toBe(
      "https://x/a?token=t",
    )
  })
})

describe("renderHealthCardSvg options", () => {
  it("honours hide=chips,meta,headline and light theme", () => {
    const svg = renderHealthCardSvg("acme", "widget", sample, {
      theme: "light",
      chips: false,
      meta: false,
      headline: false,
    })
    expect(svg).toContain("#ffffff")
    expect(svg).not.toContain("0 critical")
    expect(svg).not.toContain("findings")
    expect(svg).not.toContain("Scanned")
    expect(svg).toContain(`height="${cardHeightFor({ chips: false, meta: false, headline: false })}"`)
  })
})
