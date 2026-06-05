import { describe, it, expect } from "vitest"
import { skippedTestsScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("skippedTestsScanner", () => {
  it("warns on a focused test (.only)", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "describe.only('x', () => {})\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].title).toContain("focused")
  })

  it("infos on a skipped test (.skip / xit)", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "it.skip('one', () => {})\nxit('two', () => {})\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.severity === "info")).toBe(true)
  })

  it("flags pytest skip markers", async () => {
    const ctx = makeContext({
      files: { "test_x.py": "@pytest.mark.skip\ndef test_a():\n    pass\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
  })

  it("does not flag a clean test file", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "it('runs', () => { expect(1).toBe(1) })\n" },
    })
    expect(await skippedTestsScanner.run(ctx)).toHaveLength(0)
  })

  it("carries a file:line location", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "\n\nit.only('x', () => {})\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues[0].location).toBe("a.test.ts:3")
  })
})
