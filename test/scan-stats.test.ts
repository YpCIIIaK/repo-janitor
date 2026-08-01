import { describe, it, expect, vi } from "vitest"

// `lib/usage.ts` is server-only, and this file imports it for one assertion:
// that the two tables forbid each other's fields. The stub is the repo's
// established way of reaching a server module from a plain test.
vi.mock("server-only", () => ({}))

import {
  sizeBucket,
  projectScanStat,
  assertStatRecordable,
  FORBIDDEN_STAT_FIELDS,
  shares,
  choosePercentile,
  phrasePercentile,
  MIN_SAMPLE,
  isoDay,
  type Percentile,
} from "@/lib/scan-stats"
import { percentileCopy } from "@/lib/percentile-copy"
import { FORBIDDEN_USAGE_FIELDS } from "@/lib/usage"

describe("sizeBucket", () => {
  it("puts each size in its band", () => {
    expect(sizeBucket(0)).toBe("xs")
    expect(sizeBucket(999)).toBe("xs")
    expect(sizeBucket(1_000)).toBe("s")
    expect(sizeBucket(9_999)).toBe("s")
    expect(sizeBucket(10_000)).toBe("m")
    expect(sizeBucket(999_999)).toBe("l")
    expect(sizeBucket(1_000_000)).toBe("xl")
  })
})

describe("projectScanStat", () => {
  const report = {
    score: 67,
    grade: "C",
    generatedAt: "2026-08-01T12:34:56.000Z",
    profile: {
      languages: [
        { language: "TypeScript", files: 90, loc: 42_000 },
        { language: "CSS", files: 10, loc: 900 },
      ],
      tools: ["TypeScript", "Vitest", "GitHub Actions"],
    },
    issues: [
      { severity: "critical" },
      { severity: "warning" },
      { severity: "warning" },
      { severity: "info" },
    ],
  }

  it("reads the shape of a full engine report", () => {
    expect(projectScanStat(report)).toEqual({
      day: "2026-08-01",
      score: 67,
      grade: "C",
      language: "TypeScript",
      size: "m",
      critical: 1,
      warning: 2,
      info: 1,
      ci: true,
      tests: true,
    })
  })

  it("keeps nothing that could name the repository", () => {
    // The guarantee, asserted rather than described: whatever else changes here,
    // a row must never gain a field that points at a project.
    const stat = projectScanStat({ ...report, repo: { owner: "acme", name: "widget" } })
    for (const field of FORBIDDEN_STAT_FIELDS) {
      expect(stat).not.toHaveProperty(field)
    }
  })

  it("reads the shared projection, which has counts instead of issues", () => {
    const stat = projectScanStat({
      score: 90,
      grade: "A",
      generatedAt: "2026-08-01T00:00:00Z",
      counts: { critical: 0, warning: 1, info: 5 },
      profile: { languages: [{ language: "Go", loc: 5_000 }], tools: [] },
    })
    expect(stat).toMatchObject({ grade: "A", language: "Go", size: "s", warning: 1, info: 5 })
  })

  it("dates to the day, never the second", () => {
    // The only remaining link between the two tables is time, and this is what
    // blunts it.
    expect(projectScanStat(report)?.day).toBe("2026-08-01")
    expect(projectScanStat(report)?.day).not.toMatch(/[T:]/)
  })

  it("picks the language with the most lines, not the first listed", () => {
    const stat = projectScanStat({
      ...report,
      profile: {
        languages: [
          { language: "CSS", loc: 900 },
          { language: "Rust", loc: 80_000 },
        ],
        tools: [],
      },
    })
    expect(stat?.language).toBe("Rust")
  })

  it("returns null for anything that is not a report", () => {
    expect(projectScanStat(null)).toBeNull()
    expect(projectScanStat({})).toBeNull()
    expect(projectScanStat({ score: 50 })).toBeNull() // no grade
    expect(projectScanStat({ score: "50", grade: "C" })).toBeNull()
    expect(projectScanStat({ score: 50, grade: "Z" })).toBeNull()
  })

  it("survives a report with no profile", () => {
    const stat = projectScanStat({ score: 50, grade: "D", counts: {} })
    expect(stat).toMatchObject({ language: null, size: "xs", ci: false, tests: false })
  })
})

describe("assertStatRecordable", () => {
  it("refuses a row carrying a repository", () => {
    expect(() => assertStatRecordable({ score: 1, repo: "acme/widget" })).toThrow(/repo/)
  })

  it("refuses a row carrying a visitor id", () => {
    expect(() => assertStatRecordable({ score: 1, visitor: "abc" })).toThrow(/visitor/)
  })

  it("passes a clean row", () => {
    expect(() => assertStatRecordable({ day: "2026-08-01", score: 67, grade: "C" })).not.toThrow()
  })
})

describe("the two tables are complements", () => {
  it("each forbids what the other stores", () => {
    // The whole privacy design in one assertion: usage rows may not carry a
    // score, stat rows may not carry a repository. If a future edit relaxes
    // either, this fails.
    expect(FORBIDDEN_USAGE_FIELDS).toContain("score")
    expect(FORBIDDEN_USAGE_FIELDS).toContain("grade")
    expect(FORBIDDEN_STAT_FIELDS).toContain("repo")
    expect(FORBIDDEN_STAT_FIELDS).toContain("visitor")
  })
})

describe("shares", () => {
  it("counts strictly, in both directions", () => {
    expect(shares([10, 20, 30, 40], 30)).toEqual({ below: 50, above: 25 })
  })

  it("gives ties to neither side", () => {
    // Four identical scores: the fifth matching one is better than none of them
    // and worse than none of them, and the two do not add to a hundred.
    expect(shares([50, 50, 50, 50], 50)).toEqual({ below: 0, above: 0 })
  })

  it("handles an empty distribution", () => {
    expect(shares([], 50)).toEqual({ below: 0, above: 0 })
  })
})

describe("choosePercentile", () => {
  const many = (n: number, score: number) => Array.from({ length: n }, () => score)

  it("says nothing below the minimum sample", () => {
    // A percentile from nine repositories is a coincidence with a percent sign.
    expect(choosePercentile([{ basis: "all", scores: many(MIN_SAMPLE - 1, 10) }], 50)).toBeNull()
  })

  it("uses the first cut that has enough behind it", () => {
    const hit = choosePercentile(
      [
        { basis: "language-size", scores: many(5, 10) },
        { basis: "language", scores: many(MIN_SAMPLE, 10) },
      ],
      50,
    )
    expect(hit).toMatchObject({ basis: "language", sample: MIN_SAMPLE, betterThan: 100 })
  })

  it("reports both directions", () => {
    const scores = [...many(30, 10), ...many(30, 90)]
    expect(choosePercentile([{ basis: "all", scores }], 50)).toMatchObject({
      betterThan: 50,
      worseThan: 50,
    })
  })
})

describe("phrasePercentile", () => {
  const p = (betterThan: number, worseThan: number): Percentile => ({
    betterThan,
    worseThan,
    sample: 100,
    basis: "all",
  })

  it("tells a low score how far behind it is", () => {
    // "Better than 12%" is technically fine and reads as a sneer.
    expect(phrasePercentile(p(12, 85))).toEqual({ direction: "worse", percent: 85 })
  })

  it("tells a high score how far ahead it is", () => {
    expect(phrasePercentile(p(82, 15))).toEqual({ direction: "better", percent: 82 })
  })

  it("never derives one number from the other", () => {
    // Ties belong to neither side, so the printed percent must come from the
    // matching strict count rather than from 100 minus the other.
    expect(phrasePercentile(p(30, 20)).percent).toBe(20)
    expect(phrasePercentile(p(70, 20)).percent).toBe(70)
  })
})

describe("percentileCopy", () => {
  it("picks a key per direction and cut", () => {
    expect(
      percentileCopy({ betterThan: 10, worseThan: 88, sample: 90, basis: "language-size" }),
    ).toEqual({ key: "pct.worse.languageSize", percent: 88, direction: "worse" })
    expect(percentileCopy({ betterThan: 90, worseThan: 8, sample: 90, basis: "all" })).toEqual({
      key: "pct.better.all",
      percent: 90,
      direction: "better",
    })
  })
})

describe("isoDay", () => {
  it("formats a timestamp as a UTC date", () => {
    expect(isoDay("2026-08-01T23:59:59.000Z")).toBe("2026-08-01")
  })

  it("falls back to today for an unusable value", () => {
    expect(isoDay("not a date")).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isoDay(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
