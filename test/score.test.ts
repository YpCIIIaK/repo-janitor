import { describe, it, expect } from "vitest"
import { computeScore, scoreToGrade, categoryScores, DEFAULT_WEIGHTS } from "@/lib/score"
import { issue } from "./helpers"

describe("computeScore (client mirror of the engine)", () => {
  it("starts at 100 with no issues", () => {
    expect(computeScore([])).toBe(100)
  })

  it("subtracts weighted penalties and rounds", () => {
    expect(
      computeScore([
        issue({ severity: "critical" }),
        issue({ severity: "warning" }),
        issue({ severity: "info" }),
      ]),
    ).toBe(87) // 100 - 13.5 → 87
  })

  it("clamps at 0", () => {
    const many = Array.from({ length: 20 }, () => issue({ severity: "critical" }))
    expect(computeScore(many)).toBe(0)
  })

  it("caps the penalty a pile of info can inflict", () => {
    // 200 info would be 100 points linearly (→ score 0); the cap holds it to 15.
    const many = Array.from({ length: 200 }, () => issue({ severity: "info" }))
    expect(computeScore(many)).toBe(85)
  })

  it("caps warnings but lets criticals still tank the score", () => {
    const warnings = Array.from({ length: 100 }, () => issue({ severity: "warning" }))
    expect(computeScore(warnings)).toBe(60) // capped at 40, not 100
    const criticals = Array.from({ length: 50 }, () => issue({ severity: "critical" }))
    expect(computeScore(criticals)).toBe(0) // uncapped
  })

  it("mirrors the engine's default weights exactly", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ critical: 10, warning: 3, info: 0.5 })
  })
})

describe("scoreToGrade", () => {
  it.each([
    [90, "A"],
    [75, "B"],
    [60, "C"],
    [40, "D"],
    [39, "F"],
  ])("score %i → %s", (s, g) => {
    expect(scoreToGrade(s)).toBe(g)
  })
})

describe("categoryScores", () => {
  it("grades each category independently and returns only non-empty ones, worst first", () => {
    const result = categoryScores([
      issue({ category: "security", severity: "critical" }), // security: 90
      issue({ category: "todo", severity: "info" }), // todo: 100 → 100? 100-0.5=99.5→100
      issue({ category: "hygiene", severity: "warning" }),
      issue({ category: "hygiene", severity: "warning" }), // hygiene: 100-6=94
    ])
    expect(result.map((c) => c.category)).toEqual(["security", "hygiene", "todo"])
    const security = result.find((c) => c.category === "security")!
    expect(security.score).toBe(90)
    expect(security.grade).toBe("A")
    expect(security.count).toBe(1)
    const hygiene = result.find((c) => c.category === "hygiene")!
    expect(hygiene.count).toBe(2)
  })

  it("returns an empty array when there are no issues", () => {
    expect(categoryScores([])).toEqual([])
  })
})
