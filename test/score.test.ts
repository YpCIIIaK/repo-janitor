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
    // Criticals taper last and least, so it takes a genuinely broken repository
    // to reach the floor — but the floor is still a floor.
    const many = Array.from({ length: 200 }, () => issue({ severity: "critical" }))
    expect(computeScore(many)).toBe(0)
  })

  it("tapers a pile of info instead of charging for all of it", () => {
    // 200 info would be 50 points linearly (→ score 50). The taper holds it to 7.
    const many = Array.from({ length: 200 }, () => issue({ severity: "info" }))
    expect(computeScore(many)).toBe(93)
  })

  it("tapers warnings but lets criticals still tank the score", () => {
    const warnings = Array.from({ length: 100 }, () => issue({ severity: "warning" }))
    expect(computeScore(warnings)).toBe(47) // 53 points, not the linear 300
    const criticals = Array.from({ length: 50 }, () => issue({ severity: "critical" }))
    expect(scoreToGrade(computeScore(criticals))).toBe("F")
  })

  /**
   * The point of the info tier is "worth knowing", not "counts against you".
   * The narrowest grade band is 10 points wide, and info alone stays under that
   * for any repository anyone will actually scan.
   *
   * Stated as a bound rather than as an absolute, because the absolute is not
   * available any more and pretending otherwise would be the test lying. A hard
   * cap could promise "no quantity, ever"; a taper cannot, because the two
   * properties are opposed — a bounded total forces the marginal cost to zero,
   * which is precisely the behaviour this replaced. A thousand info notes cost
   * nine points. Ten thousand would cost more than ten, and a repository with
   * ten thousand info findings has earned a lower grade.
   */
  it("never lets info findings alone cost a grade band, at any realistic count", () => {
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
      { severity: "critical", count: 1, penalty: 10, discounted: false },
      { severity: "warning", count: 2, penalty: 6, discounted: false },
      { severity: "info", count: 1, penalty: 0.25, discounted: false },
    ])
  })

  it("keeps charging past the discount threshold, less each time", () => {
    // The rule this replaced stopped charging entirely: the hundredth info note
    // cost exactly nothing, so the tool listed a finding and privately valued it
    // at zero. Now the charge only tapers.
    const at = (n: number) =>
      penaltyBreakdown(Array.from({ length: n }, () => issue({ severity: "info" }))).find(
        (p) => p.severity === "info",
      )!

    const twenty = at(20)
    expect(twenty.discounted).toBe(false)
    expect(twenty.penalty).toBeCloseTo(5, 5) // still linear: 20 × 0.25

    const hundred = at(100)
    expect(hundred.discounted).toBe(true)
    expect(hundred.count).toBe(100)
    expect(hundred.penalty).toBeGreaterThan(twenty.penalty)
    // Each additional one costs strictly more than nothing and less than the last.
    const step = (n: number) => at(n).penalty - at(n - 1).penalty
    expect(step(100)).toBeGreaterThan(0)
    expect(step(100)).toBeLessThan(step(30))
    expect(step(30)).toBeLessThan(0.25)
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
  it("charges each finding its full tier weight before the taper", () => {
    const costs = issueCosts([
      issue({ id: "a", severity: "critical" }),
      issue({ id: "b", severity: "warning" }),
      issue({ id: "c", severity: "info" }),
    ])
    expect(costs.get("a")).toBe(10)
    expect(costs.get("b")).toBe(3)
    expect(costs.get("c")).toBe(0.25)
  })

  it("shares a tapered tier's total between its findings", () => {
    // 100 info would be 25 points linearly; the taper holds the tier to about
    // 6.4, so each finding is responsible for a fraction of the 0.25 its weight
    // suggests — but a fraction, never zero, which is what the cap used to make it.
    const many = Array.from({ length: 100 }, (_, i) => issue({ id: `i${i}`, severity: "info" }))
    const costs = issueCosts(many)
    const each = costs.get("i0")!
    expect(each).toBeGreaterThan(0)
    expect(each).toBeLessThan(0.25)
    expect(each * 100).toBeCloseTo(
      penaltyBreakdown(many).find((p) => p.severity === "info")!.penalty,
      10,
    )
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
