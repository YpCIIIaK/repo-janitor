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

describe("commented-code — documentation examples", () => {
  const count = async (content: string) =>
    (await commentedCodeScanner.run(makeContext({ files: { "src/a.go": content } }))).length

  it("skips a Go doc example indented after the marker", async () => {
    expect(await count('// GetQuery returns a value.\n//\n//\tGET /?name=Manu&lastname=\n//\t("Manu", true) == c.GetQuery("name")\n//\t("", false) == c.GetQuery("id")\nfunc x() {}\n')).toBe(0)
  })
  it("skips an example introduced by a colon and bullet lists", async () => {
    expect(await count("// Testing for these options:\n// --inspect[=[host:]port]\n// --inspect-brk[=[host:]port]\n// --inspect-port=[host:]port\n")).toBe(0)
    expect(await count("// Order:\n//   * PreRun()\n//   * Run()\n//   * PostRun()\n")).toBe(0)
  })
  it("still flags plain commented-out statements", async () => {
    expect(await count("x := 1\n// a := foo();\n// b := bar(a);\n// baz(a, b);\n")).toBe(1)
  })
})
