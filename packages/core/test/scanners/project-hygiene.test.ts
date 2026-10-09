import { describe, it, expect } from "vitest"
import { projectHygieneScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("projectHygieneScanner", () => {
  it("flags all four when the repo is bare", async () => {
    const ctx = makeContext({ files: { "src/a.ts": "x" } })
    const ids = (await projectHygieneScanner.run(ctx)).map((i) => i.id)
    expect(ids).toContain("hygiene-no-readme")
    expect(ids).toContain("hygiene-no-license")
    expect(ids).toContain("hygiene-no-tests")
    expect(ids).toContain("hygiene-no-ci")
  })

  it("emits nothing for a well-scaffolded repo", async () => {
    const ctx = makeContext({
      files: {
        "README.md": "# hi",
        "LICENSE": "MIT",
        "src/a.test.ts": "it('x', () => {})",
        ".github/workflows/ci.yml": "on: push",
      },
    })
    expect(await projectHygieneScanner.run(ctx)).toHaveLength(0)
  })

  it("README must be at the root, not in a subdir", async () => {
    const ctx = makeContext({
      files: { "docs/README.md": "# docs", "LICENSE": "MIT", "a.test.ts": "x", "Jenkinsfile": "x" },
    })
    const ids = (await projectHygieneScanner.run(ctx)).map((i) => i.id)
    expect(ids).toContain("hygiene-no-readme")
  })

  it("README is a warning, LICENSE is info", async () => {
    const ctx = makeContext({ files: { "a.test.ts": "x", "Jenkinsfile": "x" } })
    const issues = await projectHygieneScanner.run(ctx)
    expect(issues.find((i) => i.id === "hygiene-no-readme")?.severity).toBe("warning")
    expect(issues.find((i) => i.id === "hygiene-no-license")?.severity).toBe("info")
  })

  it("recognizes a test/ directory as test coverage", async () => {
    const ctx = makeContext({
      files: { "README.md": "x", "LICENSE": "x", "test/foo.js": "x", ".travis.yml": "x" },
    })
    const ids = (await projectHygieneScanner.run(ctx)).map((i) => i.id)
    expect(ids).not.toContain("hygiene-no-tests")
  })
})

describe("project hygiene — benchmark false positives", () => {
  const ids = async (opts: Parameters<typeof makeContext>[0]) =>
    (await projectHygieneScanner.run(makeContext(opts))).map((i) => i.id)

  it("accepts a README the file walk skipped (symlink) when it resolves", async () => {
    const out = await ids({ files: { "src/a.ts": "x" }, sizes: { "README.md": 10 } })
    expect(out).not.toContain("hygiene-no-readme")
  })

  it("accepts dual LICENSE-MIT / LICENSE-APACHE and COPYING", async () => {
    expect(await ids({ files: { "LICENSE-MIT": "", "LICENSE-APACHE": "" } })).not.toContain("hygiene-no-license")
    expect(await ids({ files: { COPYING: "" } })).not.toContain("hygiene-no-license")
  })

  it.each(["context_test.go", "test.js", "test.node.js", "pkg/test_api.py", "lib/foo_spec.rb", "src/FooTest.java"])(
    "recognises %s as a test",
    async (file) => {
      expect(await ids({ files: { [file]: "" } })).not.toContain("hygiene-no-tests")
    },
  )
})
