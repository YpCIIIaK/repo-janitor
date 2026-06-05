import { describe, it, expect } from "vitest"
import { lockfileDriftScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("lockfileDriftScanner", () => {
  it("warns when deps are declared but no lockfile is committed", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }) },
    })
    const issues = await lockfileDriftScanner.run(ctx)
    expect(issues.find((i) => i.id === "lockfile-missing")?.severity).toBe("warning")
  })

  it("flags a dependency declared but absent from the lockfile (drift)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0", ghost: "^1.0.0" } }),
        "package-lock.json": JSON.stringify({
          packages: { "node_modules/lodash": { version: "4.17.21" } },
        }),
      },
    })
    const issues = await lockfileDriftScanner.run(ctx)
    expect(issues.find((i) => i.id === "lockfile-drift-ghost")).toBeDefined()
    expect(issues.find((i) => i.id === "lockfile-drift-lodash")).toBeUndefined()
  })

  it("is quiet when the lockfile is in sync", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
        "package-lock.json": JSON.stringify({
          packages: { "node_modules/lodash": { version: "4.17.21" } },
        }),
      },
    })
    expect(await lockfileDriftScanner.run(ctx)).toHaveLength(0)
  })

  it("warns for a Go module with require but no go.sum", async () => {
    const ctx = makeContext({
      files: { "go.mod": "module x\n\nrequire github.com/foo/bar v1.2.3\n" },
    })
    const issues = await lockfileDriftScanner.run(ctx)
    expect(issues.find((i) => i.id === "lockfile-missing-go.sum")).toBeDefined()
  })

  it("does not warn for Go when go.sum is present", async () => {
    const ctx = makeContext({
      files: {
        "go.mod": "module x\n\nrequire github.com/foo/bar v1.2.3\n",
        "go.sum": "github.com/foo/bar v1.2.3 h1:abc\n",
      },
    })
    expect(await lockfileDriftScanner.run(ctx)).toHaveLength(0)
  })

  it("returns nothing when package.json declares no dependencies", async () => {
    const ctx = makeContext({ files: { "package.json": JSON.stringify({ name: "x" }) } })
    expect(await lockfileDriftScanner.run(ctx)).toHaveLength(0)
  })
})
