import { describe, it, expect } from "vitest"
import { todoDebtScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("todoDebtScanner", () => {
  it("flags TODO/FIXME/HACK/XXX markers in JS comments", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "// TODO: wire this up\n/* FIXME later */\nconst x = 1 // HACK\n",
      },
    })
    const issues = await todoDebtScanner.run(ctx)
    const markers = issues.map((i) => i.title)
    expect(markers.some((t) => t.startsWith("TODO"))).toBe(true)
    expect(markers.some((t) => t.startsWith("FIXME"))).toBe(true)
    expect(markers.some((t) => t.startsWith("HACK"))).toBe(true)
    expect(issues.every((i) => i.category === "todo")).toBe(true)
  })

  it("marks a year-old TODO as warning and a fresh one as info", async () => {
    const ctx = makeContext({
      files: { "a.ts": "// TODO: old one\n// TODO: new one\n" },
      blameAges: { "a.ts:1": 400, "a.ts:2": 5 },
    })
    const issues = await todoDebtScanner.run(ctx)
    const old = issues.find((i) => i.location === "a.ts:1")
    const fresh = issues.find((i) => i.location === "a.ts:2")
    expect(old?.severity).toBe("warning")
    expect(fresh?.severity).toBe("info")
  })

  it("does not flag the marker word outside a comment context", async () => {
    const ctx = makeContext({
      files: { "a.ts": 'const label = "TODO list app"\n' },
    })
    expect(await todoDebtScanner.run(ctx)).toHaveLength(0)
  })

  it("finds markers in a non-JS language via the text fallback", async () => {
    const ctx = makeContext({
      files: { "main.py": "# TODO: refactor\ndef f():\n    pass\n" },
    })
    const issues = await todoDebtScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("TODO")
  })

  it("captures the marker summary text in the title", async () => {
    const ctx = makeContext({ files: { "a.ts": "// FIXME: handle null user\n" } })
    const issues = await todoDebtScanner.run(ctx)
    expect(issues[0].title).toContain("handle null user")
  })

  it("captures every marker in a multi-line block comment, at the right lines", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "/*\n * TODO: first thing\n * FIXME: second thing\n */\nexport const x = 1\n",
      },
    })
    const issues = await todoDebtScanner.run(ctx)
    expect(issues).toHaveLength(2)
    const todo = issues.find((i) => i.title.includes("first thing"))
    const fixme = issues.find((i) => i.title.includes("second thing"))
    expect(todo?.location).toBe("a.ts:2")
    expect(fixme?.location).toBe("a.ts:3")
  })
})
