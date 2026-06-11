import { describe, it, expect } from "vitest"
import { leftoverDebugScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("leftoverDebugScanner", () => {
  it("flags console.log and debugger in JS/TS", async () => {
    const ctx = makeContext({
      files: { "a.ts": "function f() {\n  console.log('hi')\n  debugger\n}\n" },
    })
    const issues = await leftoverDebugScanner.run(ctx)
    const labels = issues.map((i) => i.title)
    expect(labels.some((t) => t.includes("console.log"))).toBe(true)
    expect(labels.some((t) => t.includes("debugger"))).toBe(true)
    expect(issues.every((i) => i.category === "hygiene")).toBe(true)
  })

  it("does NOT flag console.error / warn / info", async () => {
    const ctx = makeContext({
      files: { "a.ts": "console.error('x')\nconsole.warn('y')\nconsole.info('z')\n" },
    })
    expect(await leftoverDebugScanner.run(ctx)).toHaveLength(0)
  })

  it("skips test files", async () => {
    const ctx = makeContext({
      files: { "a.test.ts": "console.log('debug from test')\n" },
    })
    expect(await leftoverDebugScanner.run(ctx)).toHaveLength(0)
  })

  it("flags Python breakpoint() as warning and print() as info", async () => {
    const ctx = makeContext({
      files: { "main.py": "def f():\n    breakpoint()\n    print('x')\n" },
    })
    const issues = await leftoverDebugScanner.run(ctx)
    const bp = issues.find((i) => i.title.includes("breakpoint"))
    const pr = issues.find((i) => i.title.includes("print"))
    expect(bp?.severity).toBe("warning")
    expect(pr?.severity).toBe("info")
  })

  it("ignores debug calls inside line comments", async () => {
    const ctx = makeContext({
      files: { "main.py": "def f():\n    # print('debug')\n    return 1\n" },
    })
    expect(await leftoverDebugScanner.run(ctx)).toHaveLength(0)
  })

  it("flags Go fmt.Println as info", async () => {
    const ctx = makeContext({
      files: { "main.go": 'package main\nfunc f() {\n\tfmt.Println("x")\n}\n' },
    })
    const issues = await leftoverDebugScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
  })

  it("does NOT flag console.log in a shebang CLI entrypoint, but still flags debugger", async () => {
    const ctx = makeContext({
      files: {
        "cli.ts": "#!/usr/bin/env node\nconsole.log('result')\ndebugger\n",
      },
    })
    const issues = await leftoverDebugScanner.run(ctx)
    expect(issues.map((i) => i.title)).toEqual(["Leftover debugger in source"])
  })

  it("does NOT flag console.log in a package.json `bin` entrypoint", async () => {
    const ctx = makeContext({
      files: {
        "packages/cli/package.json": JSON.stringify({ bin: { foo: "./dist/index.js" } }),
        "packages/cli/src/index.ts": "console.log('hello from CLI')\n",
      },
    })
    expect(await leftoverDebugScanner.run(ctx)).toHaveLength(0)
  })

  it("does NOT flag console.log in a GitHub Action `runs.main` entrypoint", async () => {
    const ctx = makeContext({
      files: {
        "packages/action/action.yml": "runs:\n  using: node20\n  main: \"dist/index.cjs\"\n",
        "packages/action/src/index.ts": "console.log('::set-output::')\n",
      },
    })
    expect(await leftoverDebugScanner.run(ctx)).toHaveLength(0)
  })

  it("still flags console.log in a normal (non-entrypoint) source file", async () => {
    const ctx = makeContext({
      files: {
        "packages/cli/package.json": JSON.stringify({ bin: "./dist/index.js" }),
        "packages/cli/src/helper.ts": "console.log('debug')\n",
      },
    })
    const issues = await leftoverDebugScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("console.log")
  })
})
