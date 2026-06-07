import { describe, it, expect } from "vitest"
import { languageShares, type ProfileLanguage } from "@/lib/repo-profile"

const langs = (entries: [string, number, number][]): ProfileLanguage[] =>
  entries.map(([language, files, loc]) => ({ language, files, loc }))

describe("languageShares", () => {
  it("returns empty shares for no languages", () => {
    expect(languageShares([])).toEqual({ shares: [], totalLoc: 0 })
  })

  it("computes loc-based shares that sum to ~100", () => {
    const { shares, totalLoc } = languageShares(langs([["TypeScript", 5, 750], ["Go", 2, 250]]))
    expect(totalLoc).toBe(1000)
    expect(shares.map((s) => s.language)).toEqual(["TypeScript", "Go"])
    expect(shares[0].share).toBeCloseTo(75)
    expect(shares[1].share).toBeCloseTo(25)
    expect(shares.reduce((s, l) => s + l.share, 0)).toBeCloseTo(100)
  })

  it("ranks by lines of code regardless of input order", () => {
    const { shares } = languageShares(langs([["Go", 1, 100], ["TypeScript", 1, 400]]))
    expect(shares[0].language).toBe("TypeScript")
  })

  it("collapses the long tail into a single Other bucket", () => {
    const { shares } = languageShares(
      langs([
        ["TypeScript", 1, 600],
        ["Go", 1, 100],
        ["Python", 1, 90],
        ["Rust", 1, 80],
        ["Ruby", 1, 70],
        ["PHP", 1, 60],
        ["C", 1, 50],
        ["Java", 1, 40],
      ]),
      6,
    )
    expect(shares).toHaveLength(7) // 6 + Other
    const other = shares[shares.length - 1]
    expect(other.language).toBe("Other")
    expect(other.loc).toBe(90) // 50 + 40
    expect(other.files).toBe(2)
  })

  it("falls back to file counts when every LOC is zero (unreadable files)", () => {
    const { shares, totalLoc } = languageShares(langs([["TypeScript", 3, 0], ["Go", 1, 0]]))
    expect(totalLoc).toBe(0)
    expect(shares[0].language).toBe("TypeScript")
    expect(shares[0].share).toBeCloseTo(75) // 3 of 4 files
  })
})
