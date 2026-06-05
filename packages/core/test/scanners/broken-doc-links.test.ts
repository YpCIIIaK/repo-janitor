import { describe, it, expect } from "vitest"
import { brokenDocLinksScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("brokenDocLinksScanner", () => {
  it("flags a relative link whose target does not exist", async () => {
    const ctx = makeContext({
      files: { "README.md": "See [the guide](docs/guide.md) for details.\n" },
    })
    const issues = await brokenDocLinksScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].evidence).toBe("docs/guide.md")
  })

  it("does not flag a relative link that resolves to a real file", async () => {
    const ctx = makeContext({
      files: { "README.md": "See [guide](docs/guide.md).\n", "docs/guide.md": "# Guide" },
    })
    expect(await brokenDocLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores external, anchor, and root-absolute links", async () => {
    const ctx = makeContext({
      files: {
        "README.md": "[ext](https://example.com) [a](#section) [root](/abs/path) [mail](mailto:x@y.z)\n",
      },
    })
    expect(await brokenDocLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("resolves .. parent segments correctly", async () => {
    const ctx = makeContext({
      files: {
        "docs/a.md": "[up](../README.md)\n",
        "README.md": "# root",
      },
    })
    expect(await brokenDocLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag links that appear inside code fences", async () => {
    const ctx = makeContext({
      files: { "README.md": "```\n[fake](does/not/exist.md)\n```\n" },
    })
    expect(await brokenDocLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("treats a link to an existing directory as valid", async () => {
    const ctx = makeContext({
      files: { "README.md": "[the docs](docs)\n", "docs/guide.md": "# g" },
    })
    expect(await brokenDocLinksScanner.run(ctx)).toHaveLength(0)
  })
})
