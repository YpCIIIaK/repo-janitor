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

describe("rotHint measures the decline, not the last drop", () => {
  /**
   * "Rotting 12d" reads as a duration, so it has to be one. Measuring from the
   * most recent drop made a repository that had been sliding for a fortnight
   * say "Rotting since yesterday" — the number that makes the point, understated
   * into a shrug, and resetting every time the score fell again.
   */
  it("counts from where the slide began, not where it last continued", () => {
    const history = [
      { at: day(40), score: 80 },
      { at: day(12), score: 71 }, // the slide starts here
      { at: day(1), score: 68 }, // and continues
    ]
    expect(rotHint(history, NOW)).toBe("Rotting 12d")
  })

  it("keeps counting through a flat stretch that follows a fall", () => {
    // A score that dropped and then stopped moving has not recovered; the rot
    // is thirty days old, not "unchanged".
    const history = [
      { at: day(60), score: 90 },
      { at: day(30), score: 70 },
      { at: day(10), score: 70 },
    ]
    expect(rotHint(history, NOW)).toBe("Rotting 30d")
  })

  it("stops counting once the score recovers", () => {
    // An improvement ends the run — a repo that dipped and climbed back is not
    // rotting, and saying so would be the card crying wolf.
    const history = [
      { at: day(30), score: 90 },
      { at: day(10), score: 80 },
      { at: day(2), score: 85 },
    ]
    expect(rotHint(history, NOW)).toBe("Last improved 2d ago")
  })

  it("still says yesterday for a slide that is genuinely one day old", () => {
    const history = [
      { at: day(30), score: 80 },
      { at: day(1), score: 74 },
    ]
    expect(rotHint(history, NOW)).toBe("Rotting since yesterday")
  })
})

describe("an A is not rotting", () => {
  /**
   * The slide is real — 96 to 92 is a slide — but "Rotting 6d" printed under a
   * green A is the card contradicting itself, on a public README, about a
   * repository in better shape than almost anything it will be seen beside.
   */
  it("says nothing about a repository that slipped but stayed in the top band", () => {
    expect(
      rotHint([{ at: day(20), score: 96 }, { at: day(6), score: 92 }], NOW),
    ).toBeNull()
    expect(
      rotHint([{ at: day(30), score: 99 }, { at: day(3), score: 98 }], NOW),
    ).toBeNull()
  })

  it("speaks up the moment the score leaves the band", () => {
    // This is the case worth a word: not "it dipped", but "it is no longer an A".
    expect(
      rotHint([{ at: day(20), score: 94 }, { at: day(9), score: 88 }], NOW),
    ).toBe("Rotting 9d")
  })

  it("takes the boundary from the grade bands, not from a literal", () => {
    // 90 is an A and 89 is not, so the line falls between them. If the bands
    // move, this moves with them.
    expect(rotHint([{ at: day(20), score: 97 }, { at: day(5), score: 90 }], NOW)).toBeNull()
    expect(rotHint([{ at: day(20), score: 97 }, { at: day(5), score: 89 }], NOW)).toBe("Rotting 5d")
  })

  it("still congratulates an A that improved", () => {
    // Suppressing the accusation must not suppress the praise.
    expect(
      rotHint([{ at: day(20), score: 91 }, { at: day(2), score: 95 }], NOW),
    ).toBe("Last improved 2d ago")
  })
})
