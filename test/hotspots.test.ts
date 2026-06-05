import { describe, it, expect } from "vitest"
import { locationToFile, hotspotFiles } from "@/lib/hotspots"
import { issue } from "./helpers"

describe("locationToFile", () => {
  it("strips line/column suffixes", () => {
    expect(locationToFile("src/a.ts:42")).toBe("src/a.ts")
    expect(locationToFile("src/a.ts:42:7")).toBe("src/a.ts")
    expect(locationToFile("package.json")).toBe("package.json")
  })

  it("drops a ' @ <sha>' history suffix", () => {
    expect(locationToFile("src/a.ts:10 @ deadbeef")).toBe("src/a.ts")
  })

  it("returns null for branch refs and globs", () => {
    expect(locationToFile("origin/feature")).toBeNull()
    expect(locationToFile("src/**")).toBeNull()
    expect(locationToFile("")).toBeNull()
  })
})

describe("hotspotFiles", () => {
  it("groups issues by file and ranks by weighted penalty", () => {
    const spots = hotspotFiles([
      issue({ location: "a.ts:1", severity: "critical" }),
      issue({ location: "a.ts:2", severity: "warning" }),
      issue({ location: "b.ts:1", severity: "warning" }),
      issue({ location: "b.ts:2", severity: "warning" }),
    ])
    // a.ts weight = 10+3 = 13; b.ts weight = 3+3 = 6 → a.ts first
    expect(spots.map((s) => s.file)).toEqual(["a.ts", "b.ts"])
    expect(spots[0].counts).toEqual({ critical: 1, warning: 1, info: 0 })
    expect(spots[0].weight).toBe(13)
  })

  it("ignores findings without a concrete file location", () => {
    const spots = hotspotFiles([
      issue({ location: "origin/x", severity: "warning" }),
      issue({ location: "a.ts:1", severity: "warning" }),
      issue({ location: "a.ts:2", severity: "warning" }),
    ])
    expect(spots.map((s) => s.file)).toEqual(["a.ts"])
  })

  it("prefers multi-finding files, but falls back to singles when none repeat", () => {
    const spots = hotspotFiles([
      issue({ location: "a.ts:1", severity: "critical" }),
      issue({ location: "b.ts:1", severity: "info" }),
    ])
    // no file has >1 finding → keep singles, ranked by weight
    expect(spots.map((s) => s.file)).toEqual(["a.ts", "b.ts"])
  })

  it("respects the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => [
      issue({ location: `f${i}.ts:1`, severity: "critical" }),
      issue({ location: `f${i}.ts:2`, severity: "critical" }),
    ]).flat()
    expect(hotspotFiles(many, undefined, 3)).toHaveLength(3)
  })
})
