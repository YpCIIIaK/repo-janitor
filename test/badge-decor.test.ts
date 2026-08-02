import { describe, it, expect } from "vitest"
import {
  decorLayer,
  driftShapes,
  hashSeed,
  makeRandom,
  parseHex,
  shade,
} from "@/lib/badge-decor"

/**
 * The badge decoration.
 *
 * The look is a matter of taste and was settled by looking at it. What is
 * tested here is everything that is not taste: that a repository's badge is the
 * same image every time, that the shapes stay inside the twenty-pixel strip,
 * and that `motion=off` really removes the movement rather than merely hiding
 * it — the badge sits in other people's READMEs, so "no animation" has to mean
 * no animation.
 */

describe("seeded layout", () => {
  it("gives one repository the same arrangement every time", () => {
    const a = driftShapes(hashSeed("acme/widget"), 120, 20)
    const b = driftShapes(hashSeed("acme/widget"), 120, 20)
    expect(a).toEqual(b)
  })

  it("gives different repositories different arrangements", () => {
    // The whole point is variety across projects; identical output would make
    // the feature pointless without failing anything else.
    const a = driftShapes(hashSeed("acme/widget"), 120, 20)
    const b = driftShapes(hashSeed("facebook/react"), 120, 20)
    expect(a).not.toEqual(b)
  })

  it("keeps every shape's centre in the strip across its whole drift", () => {
    // Centres, not extents: a shape wider than its margin bleeds past the edge
    // and the rounded-corner clipPath cuts it, which is intentional — partial
    // shapes at the boundary read as texture continuing under the edge. What
    // must not happen is a centre leaving the strip, because then the shape
    // disappears entirely for part of its cycle and the badge looks like it is
    // flickering.
    const h = 20
    const bob = 1.2 // the vertical component of the drift keyframes
    for (const id of ["a/b", "acme/widget", "facebook/react", "YpCIIIaK/repo-janitor"]) {
      for (const s of driftShapes(hashSeed(id), 140, h)) {
        expect(s.y - bob).toBeGreaterThan(0)
        expect(s.y + bob).toBeLessThan(h)
      }
    }
  })

  it("scales the count with width and never crowds a long badge", () => {
    expect(driftShapes(1, 60, 20).length).toBeLessThan(driftShapes(1, 300, 20).length)
    expect(driftShapes(1, 3000, 20).length).toBeLessThanOrEqual(7)
    expect(driftShapes(1, 10, 20).length).toBeGreaterThanOrEqual(3)
  })

  it("starts shapes mid-flight so they do not move in lockstep", () => {
    const shapes = driftShapes(hashSeed("acme/widget"), 140, 20)
    for (const s of shapes) {
      expect(s.delay).toBeLessThanOrEqual(0)
      expect(s.delay).toBeGreaterThanOrEqual(-s.duration)
    }
    expect(new Set(shapes.map((s) => s.delay)).size).toBeGreaterThan(1)
  })
})

describe("decorLayer", () => {
  const shapes = driftShapes(hashSeed("acme/widget"), 140, 20)

  it("emits no animation at all when motion is off", () => {
    const still = decorLayer(shapes, "#ccc", false)
    expect(still).not.toMatch(/@keyframes/)
    expect(still).not.toMatch(/animation:/)
    // The texture survives — only the movement goes.
    expect(still).toMatch(/<g class="d0"/)
  })

  it("animates by default and parks under reduced motion", () => {
    const svg = decorLayer(shapes, "#ccc")
    expect(svg).toMatch(/@keyframes d0\{/)
    expect(svg).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/)
  })

  it("is empty for no shapes rather than emitting a stray style block", () => {
    expect(decorLayer([], "#ccc")).toBe("")
  })
})

describe("shade", () => {
  it("mixes towards white and black", () => {
    expect(shade("#808080", 1)).toBe("#ffffff")
    expect(shade("#808080", -1)).toBe("#000000")
    expect(shade("#808080", 0)).toBe("#808080")
  })

  it("expands three-digit hex", () => {
    expect(parseHex("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  it("returns the input unchanged when it cannot parse it", () => {
    // Grade colours come from a constant, but a bad value must degrade to a
    // flat fill rather than emit `#NaNNaNNaN` into the gradient stops.
    expect(shade("var(--grade-a)", 0.2)).toBe("var(--grade-a)")
    expect(shade("", 0.2)).toBe("")
  })
})

describe("makeRandom", () => {
  it("is deterministic and stays in [0,1)", () => {
    const a = Array.from({ length: 50 }, makeRandom(12345))
    const b = Array.from({ length: 50 }, makeRandom(12345))
    expect(a).toEqual(b)
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
