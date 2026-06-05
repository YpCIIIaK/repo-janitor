import { describe, it, expect } from "vitest"
import { ageHistogram, medianAgeDays } from "@/lib/age"
import { issue } from "./helpers"

describe("ageHistogram", () => {
  it("buckets findings by age and counts by severity", () => {
    const hist = ageHistogram([
      issue({ ageDays: 0, severity: "critical" }), // <1mo
      issue({ ageDays: 10, severity: "warning" }), // <1mo
      issue({ ageDays: 60, severity: "info" }), // 1–3mo
      issue({ ageDays: 400, severity: "critical" }), // >1y
    ])
    expect(hist.map((b) => b.label)).toEqual(["<1mo", "1–3mo", "3–6mo", "6–12mo", ">1y"])
    expect(hist[0]).toMatchObject({ critical: 1, warning: 1, info: 0, total: 2 })
    expect(hist[1]).toMatchObject({ info: 1, total: 1 })
    expect(hist[4]).toMatchObject({ critical: 1, total: 1 })
  })

  it("puts undatable (non-finite/negative) findings in the youngest bucket", () => {
    const hist = ageHistogram([
      issue({ ageDays: Number.NaN }),
      issue({ ageDays: -5 }),
    ])
    expect(hist[0].total).toBe(2)
  })

  it("returns all-zero buckets for an empty input", () => {
    const hist = ageHistogram([])
    expect(hist.every((b) => b.total === 0)).toBe(true)
  })
})

describe("medianAgeDays", () => {
  it("returns 0 for no issues", () => {
    expect(medianAgeDays([])).toBe(0)
  })

  it("returns the middle value for an odd count", () => {
    expect(medianAgeDays([issue({ ageDays: 1 }), issue({ ageDays: 5 }), issue({ ageDays: 100 })])).toBe(5)
  })

  it("averages the two middle values for an even count", () => {
    expect(medianAgeDays([issue({ ageDays: 10 }), issue({ ageDays: 20 })])).toBe(15)
  })

  it("clamps negative ages to 0 before computing", () => {
    expect(medianAgeDays([issue({ ageDays: -10 }), issue({ ageDays: -4 })])).toBe(0)
  })
})
