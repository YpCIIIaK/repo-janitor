import { describe, it, expect } from "vitest"
import { verdictOf, isBoastworthy, scopeLine } from "@/lib/verdict"

const counts = (critical = 0, warning = 0, info = 0) => ({ critical, warning, info })

describe("verdictOf", () => {
  it("calls a scan with nothing at all clean", () => {
    expect(verdictOf(counts(), 0, 100)).toBe("clean")
  })

  it("calls a high score with only notes strong", () => {
    expect(verdictOf(counts(0, 0, 3), 3, 99)).toBe("strong")
  })

  it("never congratulates over a critical finding", () => {
    // The case this function exists for. One leaked key on an otherwise
    // spotless repository still scores in the eighties, and averaging that away
    // is how a tool ends up putting a badge on a secret.
    expect(verdictOf(counts(1), 1, 85)).toBe("poor")
    expect(isBoastworthy(verdictOf(counts(1), 1, 85))).toBe(false)
  })

  it("does not call a result with warnings strong", () => {
    expect(verdictOf(counts(0, 4), 4, 80)).toBe("fair")
  })

  it("calls a middling score fair", () => {
    expect(verdictOf(counts(0, 8, 2), 10, 65)).toBe("fair")
  })

  it("calls a low score poor even with no criticals", () => {
    expect(verdictOf(counts(0, 30), 30, 41)).toBe("poor")
  })

  it("only offers the two good outcomes as boastworthy", () => {
    expect(isBoastworthy("clean")).toBe(true)
    expect(isBoastworthy("strong")).toBe(true)
    expect(isBoastworthy("fair")).toBe(false)
    expect(isBoastworthy("poor")).toBe(false)
  })
})

describe("scopeLine", () => {
  it("states files and lines", () => {
    expect(
      scopeLine({ totalFiles: 1240, languages: [{ language: "TypeScript", loc: 182431 }] }),
    ).toBe("1,240 files · 182,431 lines")
  })

  it("sums every language", () => {
    expect(
      scopeLine({
        totalFiles: 3,
        languages: [
          { language: "TypeScript", loc: 100 },
          { language: "CSS", loc: 50 },
        ],
      }),
    ).toBe("3 files · 150 lines")
  })

  it("drops a half it does not have", () => {
    expect(scopeLine({ totalFiles: 12 })).toBe("12 files")
    expect(scopeLine({ languages: [{ language: "Go", loc: 40 }] })).toBe("40 lines")
  })

  it("returns null rather than an empty line", () => {
    // "Nothing found" is equally true of an empty repository and a large one.
    // With no scope to show, the good news has nothing to stand on, so the
    // caller should render no line at all.
    expect(scopeLine(undefined)).toBeNull()
    expect(scopeLine({ totalFiles: 0, languages: [] })).toBeNull()
  })
})
