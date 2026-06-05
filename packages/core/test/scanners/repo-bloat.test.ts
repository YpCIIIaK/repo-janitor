import { describe, it, expect } from "vitest"
import { repoBloatScanner } from "../../src/index"
import { makeContext } from "../helpers"

const MB = 1024 * 1024

describe("repoBloatScanner", () => {
  it("flags a binary artifact regardless of size (warning)", async () => {
    const ctx = makeContext({
      files: { "build/app.zip": "x" },
      sizes: { "build/app.zip": 1024 },
    })
    const issues = await repoBloatScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].title).toContain("Binary artifact")
  })

  it("flags an oversized non-binary file (≥5MB) as warning", async () => {
    const ctx = makeContext({
      files: { "data/big.json": "x" },
      sizes: { "data/big.json": 6 * MB },
    })
    const issues = await repoBloatScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("Large file")
  })

  it("flags heavy media (≥2MB) as info but not small media", async () => {
    const ctx = makeContext({
      files: { "a/heavy.png": "x", "a/small.png": "y" },
      sizes: { "a/heavy.png": 3 * MB, "a/small.png": 50 * 1024 },
    })
    const issues = await repoBloatScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("a/heavy.png")
    expect(issues[0].severity).toBe("info")
  })

  it("does not flag ordinary small source files", async () => {
    const ctx = makeContext({
      files: { "src/a.ts": "const a = 1\n" },
      sizes: { "src/a.ts": 200 },
    })
    expect(await repoBloatScanner.run(ctx)).toHaveLength(0)
  })

  it("ranks findings largest-first", async () => {
    const ctx = makeContext({
      files: { "small.zip": "x", "big.zip": "y" },
      sizes: { "small.zip": 1024, "big.zip": 10 * MB },
    })
    const issues = await repoBloatScanner.run(ctx)
    expect(issues[0].location).toBe("big.zip")
  })
})
