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
      issue({ category: "secret", severity: "critical" }), // secret: 90
      issue({ category: "todo", severity: "info" }), // todo: 100 → 100? 100-0.5=99.5→100
      issue({ category: "hygiene", severity: "warning" }),
      issue({ category: "hygiene", severity: "warning" }), // hygiene: 100-6=94
    ])
    expect(result.map((c) => c.category)).toEqual(["secret", "hygiene", "todo"])
    const secret = result.find((c) => c.category === "secret")!
    expect(secret.score).toBe(90)
    expect(secret.grade).toBe("A")
    expect(secret.count).toBe(1)
    const hygiene = result.find((c) => c.category === "hygiene")!
    expect(hygiene.count).toBe(2)
  })

  it("returns an empty array when there are no issues", () => {
    expect(categoryScores([])).toEqual([])
  })
})
