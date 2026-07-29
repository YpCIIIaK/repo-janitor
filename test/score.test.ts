import { describe, it, expect } from "vitest"
import {
  computeScore,
  scoreToGrade,
  categoryScores,
  categoryCosts,
  issueCosts,
  penaltyBreakdown,
  DEFAULT_WEIGHTS,
} from "@/lib/score"
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
    ).toBe(87) // 100 - 13.25 → 87
  })

  it("clamps at 0", () => {
    const many = Array.from({ length: 20 }, () => issue({ severity: "critical" }))
    expect(computeScore(many)).toBe(0)
  })

  it("caps the penalty a pile of info can inflict", () => {
    // 200 info would be 50 points linearly (→ score 50); the cap holds it to 8.
    const many = Array.from({ length: 200 }, () => issue({ severity: "info" }))
    expect(computeScore(many)).toBe(92)
  })

  it("caps warnings but lets criticals still tank the score", () => {
    const warnings = Array.from({ length: 100 }, () => issue({ severity: "warning" }))
    expect(computeScore(warnings)).toBe(60) // capped at 40, not 100
    const criticals = Array.from({ length: 50 }, () => issue({ severity: "critical" }))
    expect(computeScore(criticals)).toBe(0) // uncapped
  })

  /**
   * The point of the info tier is "worth knowing", not "counts against you".
   * The narrowest grade band is 10 points wide, so as long as the info cap stays
   * under that, no quantity of info findings can drop a repo a grade on its own.
   * This asserts the property rather than the constant, so it keeps holding if
   * someone retunes the weight.
   */
  it("never lets info findings alone cost a grade band", () => {
    for (const count of [1, 10, 100, 1000]) {
      const many = Array.from({ length: count }, () => issue({ severity: "info" }))
      expect(scoreToGrade(computeScore(many))).toBe("A")
    }
  })

  it("mirrors the engine's default weights exactly", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ critical: 10, warning: 3, info: 0.25 })
  })
})

describe("penaltyBreakdown", () => {
  it("reports each tier's count and the points it actually cost", () => {
    const result = penaltyBreakdown([
      issue({ severity: "critical" }),
      issue({ severity: "warning" }),
      issue({ severity: "warning" }),
      issue({ severity: "info" }),
    ])
    expect(result).toEqual([
      { severity: "critical", count: 1, penalty: 10, capped: false },
      { severity: "warning", count: 2, penalty: 6, capped: false },
      { severity: "info", count: 1, penalty: 0.25, capped: false },
    ])
  })

  it("flags a tier whose cap has bitten — further findings there are free", () => {
    const many = Array.from({ length: 100 }, () => issue({ severity: "info" }))
    const info = penaltyBreakdown(many).find((p) => p.severity === "info")!
    expect(info.penalty).toBe(8)
    expect(info.capped).toBe(true)
    expect(info.count).toBe(100) // the count is honest even though the charge stopped
  })

  /**
   * The whole point of deriving one from the other: a breakdown that summed to
   * something other than the score would be a lie told in the most visible place
   * on the dashboard.
   */
  it("always sums to exactly the points the score is missing", () => {
    const sets = [
      [],
      [issue({ severity: "info" })],
      Array.from({ length: 40 }, () => issue({ severity: "warning" })),
      Array.from({ length: 300 }, (_, i) =>
        issue({ severity: (["critical", "warning", "info"] as const)[i % 3] }),
      ),
    ]
    for (const set of sets) {
      const total = penaltyBreakdown(set).reduce((sum, p) => sum + p.penalty, 0)
      expect(computeScore(set)).toBe(Math.max(0, Math.round(100 - total)))
    }
  })
})

describe("issueCosts", () => {
  it("charges each finding its tier weight below the cap", () => {
    const costs = issueCosts([
      issue({ id: "a", severity: "critical" }),
      issue({ id: "b", severity: "warning" }),
      issue({ id: "c", severity: "info" }),
    ])
    expect(costs.get("a")).toBe(10)
    expect(costs.get("b")).toBe(3)
    expect(costs.get("c")).toBe(0.25)
  })

  it("shares a capped tier's total between its findings", () => {
    // 100 info would be 25 points linearly; the cap holds the tier to 8, so each
    // finding is responsible for 0.08 — not the 0.25 the weight suggests.
    const many = Array.from({ length: 100 }, (_, i) => issue({ id: `i${i}`, severity: "info" }))
    const costs = issueCosts(many)
    expect(costs.get("i0")).toBeCloseTo(0.08, 10)
  })

  /**
   * The number shown against a finding is a claim about the score. If the claims
   * did not add up to the points actually missing, every one of them would be
   * wrong by an amount nobody could work out.
   */
  it("always sums to exactly the points the score is missing", () => {
    const sets = [
      [issue({ id: "x", severity: "critical" })],
      Array.from({ length: 60 }, (_, i) => issue({ id: `w${i}`, severity: "warning" })),
      Array.from({ length: 200 }, (_, i) =>
        issue({ id: `m${i}`, severity: (["critical", "warning", "info"] as const)[i % 3] }),
      ),
    ]
    for (const set of sets) {
      const total = [...issueCosts(set).values()].reduce((a, b) => a + b, 0)
      expect(computeScore(set)).toBe(Math.max(0, Math.round(100 - total)))
    }
  })
})

describe("categoryCosts", () => {
  it("attributes points to categories, worst first", () => {
    const result = categoryCosts([
      issue({ id: "a", category: "security", severity: "critical" }),
      issue({ id: "b", category: "todo", severity: "info" }),
      issue({ id: "c", category: "hygiene", severity: "warning" }),
      issue({ id: "d", category: "hygiene", severity: "warning" }),
    ])
    expect(result.map((c) => c.category)).toEqual(["security", "hygiene", "todo"])
    expect(result[0].cost).toBe(10)
    expect(result[1].cost).toBe(6)
    expect(result[1].count).toBe(2)
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
