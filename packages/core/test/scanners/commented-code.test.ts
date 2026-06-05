import { describe, it, expect } from "vitest"
import { commentedCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("commentedCodeScanner", () => {
  it("flags a run of 3+ commented-out code lines", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "function f() {",
          "  // const x = compute();",
          "  // doThing(x);",
          "  // return x + 1;",
          "  return 0",
          "}",
        ].join("\n"),
      },
    })
    const issues = await commentedCodeScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("3 lines")
    expect(issues[0].location).toBe("a.ts:2")
  })

  it("does NOT flag ordinary prose comments", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "// This function computes the thing.",
          "// It handles the edge cases too.",
          "// See the docs for more details.",
          "function f() { return 1 }",
        ].join("\n"),
      },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag a short (2-line) commented block", async () => {
    const ctx = makeContext({
      files: { "a.ts": "// const x = 1;\n// foo(x);\nconst y = 2\n" },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("skips eslint/ts directive comments", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "// eslint-disable-next-line",
          "// @ts-expect-error something",
          "// prettier-ignore",
          "const y = 2",
        ].join("\n"),
      },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })
})
