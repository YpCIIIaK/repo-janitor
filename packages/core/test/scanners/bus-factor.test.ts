import { describe, it, expect } from "vitest"
import { busFactorScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("busFactorScanner", () => {
  it("flags a stale single-author source file", async () => {
    const ctx = makeContext({
      files: { "src/legacy.ts": "export const x = 1\n" },
      ownership: { "src/legacy.ts": { authors: 1, ageDays: 500 } },
    })
    const issues = await busFactorScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("src/legacy.ts")
    expect(issues[0].severity).toBe("info")
  })

  it("ignores a recently-touched single-author file", async () => {
    const ctx = makeContext({
      files: { "src/active.ts": "x" },
      ownership: { "src/active.ts": { authors: 1, ageDays: 30 } },
    })
    expect(await busFactorScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores files with more than one author", async () => {
    const ctx = makeContext({
      files: { "src/shared.ts": "x" },
      ownership: { "src/shared.ts": { authors: 3, ageDays: 500 } },
    })
    expect(await busFactorScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores non-source files", async () => {
    const ctx = makeContext({
      files: { "docs/notes.md": "x" },
      ownership: { "docs/notes.md": { authors: 1, ageDays: 500 } },
    })
    expect(await busFactorScanner.run(ctx)).toHaveLength(0)
  })

  it("returns nothing when git ownership is unavailable", async () => {
    const ctx = makeContext({ files: { "src/a.ts": "x" } }) // no ownership → no adapter
    expect(await busFactorScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores ownership entries not in the tracked file list", async () => {
    const ctx = makeContext({
      files: { "src/a.ts": "x" },
      ownership: { "src/deleted.ts": { authors: 1, ageDays: 999 } },
    })
    expect(await busFactorScanner.run(ctx)).toHaveLength(0)
  })
})
