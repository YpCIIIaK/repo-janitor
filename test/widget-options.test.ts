import { describe, it, expect } from "vitest"
import {
  DEFAULT_CARD_HEIGHT,
  DEFAULT_WIDGET_OPTIONS,
  appendWidgetOptions,
  embedDimensions,
  formatBadgeMessage,
  parseWidgetOptions,
  widgetOptionsQuery,
} from "@/lib/widget-options"
import { badgeMarkdown, cardMarkdown, embedSnippet } from "@/lib/badge-markdown"
import { CARD_HEIGHT, renderHealthCardSvg, type HealthCardData } from "@/lib/health-card"

/**
 * There is one option left: `?theme=light`.
 *
 * The others — hide, message, style, label, size — are gone along with the panel
 * that drove them. What is tested here is that the one that remains still works
 * end to end, and that dropping the rest did not quietly change the default
 * rendering: a README that pasted a plain URL must get exactly what it got
 * before.
 */

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

  it("reads the theme", () => {
    expect(parseWidgetOptions("theme=light").theme).toBe("light")
    expect(parseWidgetOptions("theme=dark").theme).toBe("dark")
    expect(parseWidgetOptions("theme=neon").theme).toBe("dark")
  })

  it("ignores the retired options instead of failing on them", () => {
    // Someone's README may still carry them. Silently rendering the default is
    // the right answer; a broken image because of a stale query is not.
    expect(
      parseWidgetOptions("style=flat-square&message=grade&size=roomy&label=x&hide=chips,meta"),
    ).toEqual(DEFAULT_WIDGET_OPTIONS)
  })

  it("omits the default from the serialized query", () => {
    expect(widgetOptionsQuery(DEFAULT_WIDGET_OPTIONS).toString()).toBe("")
    expect(widgetOptionsQuery({ theme: "light" }).get("theme")).toBe("light")
  })
})

describe("formatBadgeMessage", () => {
  it("always shows grade and score", () => {
    expect(formatBadgeMessage("A", 94)).toBe("A 94")
  })
})

describe("dimensions", () => {
  it("has one embed size and one card height", () => {
    expect(embedDimensions()).toEqual({ width: 420, height: 228 })
    expect(DEFAULT_CARD_HEIGHT).toBe(CARD_HEIGHT)
  })
})

describe("URL helpers", () => {
  it("keeps default markdown URLs short", () => {
    expect(badgeMarkdown(ORIGIN, SHARE)).toBe(
      `[![Repo Anti-Rot](${ORIGIN}/api/badge/acme/widget?token=tok123)](${ORIGIN}/r/acme/widget/tok123)`,
    )
    expect(cardMarkdown(ORIGIN, SHARE)).toContain("?token=tok123")
    expect(cardMarkdown(ORIGIN, SHARE)).not.toContain("theme=")
  })

  it("appends the theme to badge, card and embed", () => {
    const opts = { theme: "light" as const }
    expect(badgeMarkdown(ORIGIN, SHARE, opts)).toContain("theme=light")
    expect(cardMarkdown(ORIGIN, SHARE, opts)).toContain("theme=light")
    const html = embedSnippet(ORIGIN, SHARE, opts)
    expect(html).toContain("theme=light")
    expect(html).toContain('height="228"')
  })

  it("appendWidgetOptions is a no-op for defaults", () => {
    expect(appendWidgetOptions("https://x/a?token=t", DEFAULT_WIDGET_OPTIONS)).toBe(
      "https://x/a?token=t",
    )
  })
})

describe("renderHealthCardSvg", () => {
  it("renders every band, at the one card height", () => {
    const svg = renderHealthCardSvg("acme", "widget", sample)
    expect(svg).toContain("0 critical")
    expect(svg).toContain("Scanned")
    expect(svg).toContain(`height="${CARD_HEIGHT}"`)
  })

  it("honours the light theme", () => {
    const svg = renderHealthCardSvg("acme", "widget", sample, { theme: "light" })
    // The background is seeded per repository, so the assertion is on a palette
    // colour that only the light theme uses, not on the gradient stops.
    expect(svg).toContain("#1f2328")
  })
})
