import { describe, it, expect } from "vitest"
import { median, summarize } from "@/lib/scan-summary"
import { MIN_SAMPLE } from "@/lib/scan-stats"

/**
 * The landing page's numbers.
 *
 * These sit on a front page as social proof, which is the place a wrong number
 * does the most damage — so the tests are mostly about refusing to speak: the
 * threshold, and what happens with a sample that is not one.
 */

const scores = (n: number, value: number) => Array.from({ length: n }, () => value)

describe("median", () => {
  it("takes the middle of an odd sample", () => {
    expect(median([10, 90, 50])).toBe(50)
  })

  it("averages the two middles of an even sample", () => {
    expect(median([10, 40, 60, 90])).toBe(50)
  })

  it("does not care what order it is given", () => {
    expect(median([90, 10, 50, 70, 30])).toBe(50)
  })

  it("is not dragged by the floor the way a mean is", () => {
    // Four zeros among twenty-one repositories is realistic — a dozen live CVEs
    // earns one. The mean of this is 57; no repository here scores 57.
    const sample = [...scores(4, 0), ...scores(17, 70)]
    expect(median(sample)).toBe(70)
    const mean = Math.round(sample.reduce((a, b) => a + b, 0) / sample.length)
    expect(mean).toBeLessThan(60)
  })

  it("returns 0 for nothing rather than NaN", () => {
    expect(median([])).toBe(0)
  })
})

describe("summarize", () => {
  it("says nothing below the sample threshold", () => {
    // The same threshold the percentile uses. Two surfaces drawn from one table
    // must not disagree about whether there is enough data to speak.
    expect(summarize(scores(MIN_SAMPLE - 1, 70))).toBeNull()
    expect(summarize([])).toBeNull()
  })

  it("speaks at exactly the threshold", () => {
    expect(summarize(scores(MIN_SAMPLE, 70))).not.toBeNull()
  })

  it("counts every score into exactly one band", () => {
    const sample = [95, 91, 80, 76, 65, 61, 45, 41, 10, 0, ...scores(MIN_SAMPLE - 10, 70)]
    const out = summarize(sample)!
    const total = Object.values(out.grades).reduce((a, b) => a + b, 0)
    expect(total).toBe(sample.length)
    expect(out.count).toBe(sample.length)
  })

  it("puts each score in the band the grade function says", () => {
    // Boundaries, because an off-by-one here mislabels a whole column of the bar
    // chart and nobody would notice.
    const out = summarize([90, 89, 75, 74, 60, 59, 40, 39, ...scores(MIN_SAMPLE - 8, 100)])!
    expect(out.grades.A).toBe(1 + (MIN_SAMPLE - 8)) // 90 and the filler 100s
    expect(out.grades.B).toBe(2) // 89, 75
    expect(out.grades.C).toBe(2) // 74, 60
    expect(out.grades.D).toBe(2) // 59, 40
    expect(out.grades.F).toBe(1) // 39
  })
})
