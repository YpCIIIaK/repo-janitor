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

  it("does NOT flag a marker that only appears inside a string literal", async () => {
    // A scanner's own fixture: the text "describe.only(...)" is DATA, not a call.
    const ctx = makeContext({
      files: {
        "scanner.test.ts":
          "const ctx = makeContext({ files: { 'a.test.ts': \"describe.only('x', () => {})\\n\" } })\n" +
          "expect(run(ctx)).toHaveLength(1)\n",
      },
    })
    expect(await skippedTestsScanner.run(ctx)).toHaveLength(0)
  })

  it("flags a real .only even when a string literal also mentions one", async () => {
    const ctx = makeContext({
      files: {
        "a.test.ts": "const sample = 'it.only(...)'\nit.only('real', () => {})\n",
      },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("a.test.ts:2") // the real call, not the string on line 1
  })

  it("falls back to regex when the file can't be parsed", async () => {
    // Deliberately broken TS so the parser bails → line-regex fallback kicks in.
    const ctx = makeContext({
      files: { "broken.test.ts": "it.only('x', () => {\nthis is not valid <<< ts\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
  })

  it("carries a file:line location", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "\n\nit.only('x', () => {})\n" },
    })
    const issues = await skippedTestsScanner.run(ctx)
    expect(issues[0].location).toBe("a.test.ts:3")
  })
})
