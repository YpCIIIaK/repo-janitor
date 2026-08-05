import { describe, expect, it } from "vitest"

import {
  MAX_TIER,
  NO_SIGNALS,
  TIER_NAMES,
  TIER_THRESHOLDS,
  cardMarks,
  cardPalette,
  cardPoints,
  nextStepHint,
  renderContributorCardSvg,
  tierOf,
  tierProgress,
  type ContributorSignals,
} from "@/lib/contributor-card"

import { hashSeed } from "@/lib/badge-decor"

const signals = (s: Partial<ContributorSignals>): ContributorSignals => ({
  ...NO_SIGNALS,
  ...s,
})

describe("cardPoints", () => {
  it("gives nothing for no signals", () => {
    expect(cardPoints(NO_SIGNALS)).toBe(0)
  })

  it("weights a confirmed report above a clean week", () => {
    const fp = cardPoints(signals({ confirmedFalsePositives: 1 }))
    const week = cardPoints(signals({ cleanStreakWeeks: 1 }))
    expect(fp).toBeGreaterThan(week)
  })

  it("caps each signal so one dimension cannot carry the card", () => {
    // Tenure alone must not reach the top: the ladder is meant to need breadth.
    expect(tierOf(cardPoints(signals({ cleanStreakWeeks: 500 })))).toBeLessThan(MAX_TIER)
    expect(tierOf(cardPoints(signals({ confirmedFalsePositives: 500 })))).toBeLessThan(MAX_TIER)
    expect(tierOf(cardPoints(signals({ areasTouched: 500 })))).toBeLessThan(MAX_TIER)
  })

  it("ignores negative and non-finite input rather than going backwards", () => {
    expect(cardPoints(signals({ cleanStreakWeeks: -20 }))).toBe(0)
    expect(cardPoints(signals({ areasTouched: Number.NaN }))).toBe(0)
  })

  it("is reachable at the top by working on more than one axis", () => {
    const maxed = cardPoints({
      confirmedFalsePositives: 4,
      cleanStreakWeeks: 12,
      areasTouched: 6,
    })
    expect(tierOf(maxed)).toBe(MAX_TIER)
  })
})

describe("tierOf", () => {
  it("starts every tier exactly at its threshold", () => {
    TIER_THRESHOLDS.forEach((points, tier) => {
      expect(tierOf(points)).toBe(tier)
      if (tier > 0) expect(tierOf(points - 1)).toBe(tier - 1)
    })
  })

  it("never exceeds the top tier", () => {
    expect(tierOf(10_000)).toBe(MAX_TIER)
    expect(TIER_NAMES).toHaveLength(MAX_TIER + 1)
  })

  it("does not go below zero", () => {
    expect(tierOf(-5)).toBe(0)
  })
})

describe("tierProgress", () => {
  it("reports a full bar and no next step at the top", () => {
    const top = tierProgress(TIER_THRESHOLDS[MAX_TIER] + 50)
    expect(top).toEqual({ tier: MAX_TIER, ratio: 1, pointsToNext: null })
  })

  it("rises monotonically within a tier", () => {
    const a = tierProgress(TIER_THRESHOLDS[1])
    const b = tierProgress(TIER_THRESHOLDS[1] + 1)
    expect(b.ratio).toBeGreaterThan(a.ratio)
    expect(b.pointsToNext!).toBeLessThan(a.pointsToNext!)
  })

  it("keeps the ratio inside 0..1", () => {
    for (let p = 0; p < 60; p++) {
      const { ratio } = tierProgress(p)
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThanOrEqual(1)
    }
  })
})

describe("nextStepHint", () => {
  it("names a concrete action, not points", () => {
    const hint = nextStepHint(NO_SIGNALS)
    expect(hint).toBeTruthy()
    expect(hint).not.toMatch(/point/i)
    expect(hint).toMatch(/week|area|report/)
  })

  it("prefers the route that needs nobody else when counts tie", () => {
    // One clean week and one new area both close a 1-point gap; the week wins
    // because it does not depend on a maintainer or on a suitable task existing.
    const almost = signals({ cleanStreakWeeks: 2, areasTouched: 0 })
    expect(nextStepHint(almost)).toMatch(/clean week/)
  })

  it("does not steer everyone at once towards filing reports", () => {
    // A report is worth four clean weeks, so ranking routes by how many of each
    // is needed would recommend reporting on nearly every card — pressure on the
    // one route a maintainer has to grant. Self-directed routes come first.
    const mid = signals({ confirmedFalsePositives: 1, cleanStreakWeeks: 2, areasTouched: 2 })
    expect(nextStepHint(mid)).not.toMatch(/report/)
  })

  it("suggests a partial step instead of claiming the top tier early", () => {
    // Caps leave this card unable to reach tier 5 by any single signal. The bug
    // this guards is returning null there, which the card renders as "top tier"
    // on somebody sitting at four.
    const stuck = signals({ confirmedFalsePositives: 3, cleanStreakWeeks: 5, areasTouched: 4 })
    expect(tierOf(cardPoints(stuck))).toBeLessThan(MAX_TIER)
    const hint = nextStepHint(stuck)
    expect(hint).toBeTruthy()
    expect(hint).toMatch(/^Closer:/)
  })

  it("only goes silent at the actual top of the ladder", () => {
    const cases: ContributorSignals[] = [
      NO_SIGNALS,
      signals({ cleanStreakWeeks: 12 }),
      signals({ confirmedFalsePositives: 4, areasTouched: 6 }),
      signals({ confirmedFalsePositives: 2, cleanStreakWeeks: 9, areasTouched: 5 }),
      signals({ confirmedFalsePositives: 3, cleanStreakWeeks: 11, areasTouched: 6 }),
    ]
    for (const c of cases) {
      const silent = nextStepHint(c) === null
      expect(silent).toBe(tierOf(cardPoints(c)) === MAX_TIER)
    }
  })

  it("says nothing once the ladder is finished", () => {
    expect(
      nextStepHint({ confirmedFalsePositives: 4, cleanStreakWeeks: 12, areasTouched: 6 }),
    ).toBeNull()
  })

  it("never suggests a route that is already capped out", () => {
    const cappedWeeks = signals({ cleanStreakWeeks: 12, areasTouched: 1 })
    expect(nextStepHint(cappedWeeks)).not.toMatch(/clean week/)
  })
})

describe("seed vs signals", () => {
  it("keeps the palette identical as the tier changes hue-wise", () => {
    // The rule the whole design rests on: growth may add colours, never swap
    // them. A card that changes colour on promotion is not recognisably yours.
    const seed = hashSeed("octocat")
    const low = cardPalette(seed, 0, true)
    const high = cardPalette(seed, MAX_TIER, true)
    expect(high.slice(0, low.length)).toEqual(low)
    expect(high.length).toBeGreaterThan(low.length)
  })

  it("gives different logins different palettes", () => {
    const a = cardPalette(hashSeed("octocat"), 3, true)
    const b = cardPalette(hashSeed("torvalds"), 3, true)
    expect(a[0]).not.toBe(b[0])
  })

  it("renders the same login identically every time", () => {
    const once = renderContributorCardSvg("octocat", signals({ cleanStreakWeeks: 4 }))
    const twice = renderContributorCardSvg("octocat", signals({ cleanStreakWeeks: 4 }))
    expect(once).toBe(twice)
  })

  it("seeds from the login case-insensitively but prints it as given", () => {
    // GitHub treats the two as one account, so they must not be two different
    // looking cards — while the name on the card stays spelled the way it is.
    const marks = (svg: string) => /<g clip-path="url\(#cclip\)">([\s\S]*?)<\/g>\n/.exec(svg)?.[1]

    const upper = renderContributorCardSvg("OctoCat")
    expect(marks(upper)).toBe(marks(renderContributorCardSvg("octocat")))
    expect(upper).toContain(">OctoCat<")
  })
})

describe("cardMarks", () => {
  it("gets denser with every tier", () => {
    const seed = hashSeed("octocat")
    const counts = Array.from({ length: MAX_TIER + 1 }, (_, t) => cardMarks(seed, t).length)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1])
    }
  })

  it("keeps marks the same size at every tier", () => {
    // Sizing marks off the cell made the emptiest card carry the biggest shapes,
    // so the ladder looked like it ran backwards. Only the count may change.
    const seed = hashSeed("octocat")
    const largest = (t: number) => Math.max(...cardMarks(seed, t).map((m) => m.size))
    const low = largest(0)
    for (let t = 1; t <= MAX_TIER; t++) {
      expect(largest(t)).toBeCloseTo(low, 0)
    }
  })

  it("stops growing past the top tier", () => {
    const seed = hashSeed("octocat")
    expect(cardMarks(seed, 99).length).toBe(cardMarks(seed, MAX_TIER).length)
  })

  it("keeps every mark inside the card", () => {
    for (const login of ["a", "octocat", "sindresorhus"]) {
      for (const mark of cardMarks(hashSeed(login), MAX_TIER)) {
        expect(mark.x).toBeGreaterThan(0)
        expect(mark.x).toBeLessThan(300)
        expect(mark.y).toBeGreaterThan(0)
        expect(mark.y).toBeLessThan(420)
      }
    }
  })
})

describe("renderContributorCardSvg", () => {
  it("produces a standalone SVG", () => {
    const svg = renderContributorCardSvg("octocat")
    expect(svg).toContain("<svg")
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
  })

  it("carries the tier in the accessible label, not only in the colour", () => {
    const svg = renderContributorCardSvg("octocat", signals({ confirmedFalsePositives: 2 }))
    expect(svg).toMatch(/aria-label="[^"]*tier \d of \d/)
    expect(svg).toContain("<title>")
  })

  it("escapes a login rather than letting it write markup", () => {
    const svg = renderContributorCardSvg('a"><script>alert(1)</script>')
    expect(svg).not.toContain("<script")
    expect(svg).toContain("&lt;")
  })

  it("shows the raw counts so the tier can be checked against them", () => {
    const svg = renderContributorCardSvg(
      "octocat",
      signals({ confirmedFalsePositives: 3, cleanStreakWeeks: 7, areasTouched: 2 }),
    )
    expect(svg).toContain("confirmed reports")
    expect(svg).toContain("clean weeks")
    expect(svg).toContain("areas touched")
  })

  it("renders both themes", () => {
    const dark = renderContributorCardSvg("octocat", NO_SIGNALS, { theme: "dark" })
    const light = renderContributorCardSvg("octocat", NO_SIGNALS, { theme: "light" })
    expect(dark).not.toBe(light)
    expect(light).toContain("#f6f8fa")
  })
})
