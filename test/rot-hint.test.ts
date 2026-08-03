import { describe, it, expect } from "vitest"
import { rotHint } from "@/lib/rot-hint"

const day = (n: number) => {
  // Fixed "now" = 2026-08-03T12:00:00Z → day 0
  const ms = Date.UTC(2026, 7, 3, 12, 0, 0) - n * 86_400_000
  return new Date(ms).toISOString()
}

const NOW = Date.UTC(2026, 7, 3, 12, 0, 0)

describe("rotHint", () => {
  it("returns null with fewer than two points", () => {
    expect(rotHint([{ at: day(0), score: 90 }], NOW)).toBeNull()
    expect(rotHint([], NOW)).toBeNull()
  })

  it("reports last improvement age", () => {
    expect(
      rotHint(
        [
          { at: day(40), score: 80 },
          { at: day(20), score: 90 },
          { at: day(5), score: 90 },
        ],
        NOW,
      ),
    ).toBe("Last improved 20d ago")
  })

  it("reports rotting after a decline", () => {
    expect(
      rotHint(
        [
          { at: day(30), score: 94 },
          { at: day(10), score: 88 },
          { at: day(2), score: 88 },
        ],
        NOW,
      ),
    ).toBe("Rotting 10d")
  })

  it("prefers rotting when a decline follows an improvement", () => {
    expect(
      rotHint(
        [
          { at: day(40), score: 70 },
          { at: day(20), score: 90 },
          { at: day(5), score: 82 },
        ],
        NOW,
      ),
    ).toBe("Rotting 5d")
  })

  it("uses today / yesterday wording", () => {
    expect(
      rotHint(
        [
          { at: day(2), score: 80 },
          { at: day(0), score: 90 },
        ],
        NOW,
      ),
    ).toBe("Improved today")
    expect(
      rotHint(
        [
          { at: day(3), score: 90 },
          { at: day(1), score: 80 },
        ],
        NOW,
      ),
    ).toBe("Rotting since yesterday")
  })

  it("nags only after a week of flat scores", () => {
    expect(
      rotHint(
        [
          { at: day(3), score: 94 },
          { at: day(0), score: 94 },
        ],
        NOW,
      ),
    ).toBeNull()
    expect(
      rotHint(
        [
          { at: day(14), score: 94 },
          { at: day(0), score: 94 },
        ],
        NOW,
      ),
    ).toBe("Unchanged 14d")
  })
})
