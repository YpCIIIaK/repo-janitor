import { describe, it, expect } from "vitest"
import { dependencyFuneralScanner } from "../../src/index"
import { makeContext } from "../helpers"

const reg = (name: string) => `https://registry.npmjs.org/${name}`
const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString()

describe("dependencyFuneralScanner", () => {
  it("flags an installed-but-never-imported dependency (works offline)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { unused: "1.0.0", used: "1.0.0" } }),
        "a.ts": "import { thing } from 'used'\nthing()\n",
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe("dep-unused-unused")
    expect(issues[0].severity).toBe("info")
  })

  it("never flags @types/* packages as unused", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { "@types/node": "20.0.0" } }) },
    })
    expect(await dependencyFuneralScanner.run(ctx)).toHaveLength(0)
  })

  it("flags a deprecated package as warning", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { left: "1.0.0" } }),
        "a.ts": "import 'left'\n",
      },
      fetchJson: {
        [reg("left")]: {
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { deprecated: "use something else" } },
          time: { "1.0.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.find((i) => i.id === "dep-deprecated-left")?.severity).toBe("warning")
  })

  it("flags an abandoned package (no release in 2+ years)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { old: "1.0.0" } }),
        "a.ts": "import 'old'\n",
      },
      fetchJson: {
        [reg("old")]: {
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": {} },
          time: { "1.0.0": threeYearsAgo },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.some((i) => i.id === "dep-abandoned-old")).toBe(true)
  })

  it("flags a major-behind package as warning and minor as info", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { major: "1.0.0", minor: "2.0.0" } }),
        "a.ts": "import 'major'\nimport 'minor'\n",
      },
      fetchJson: {
        [reg("major")]: {
          "dist-tags": { latest: "3.0.0" },
          versions: { "3.0.0": {} },
          time: { "3.0.0": new Date().toISOString() },
        },
        [reg("minor")]: {
          "dist-tags": { latest: "2.5.0" },
          versions: { "2.5.0": {} },
          time: { "2.5.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.find((i) => i.id === "dep-outdated-major")?.severity).toBe("warning")
    expect(issues.find((i) => i.id === "dep-outdated-minor")?.severity).toBe("info")
  })

  it("returns nothing when package.json is absent or has no deps", async () => {
    expect(await dependencyFuneralScanner.run(makeContext({ files: {} }))).toHaveLength(0)
    const empty = makeContext({ files: { "package.json": JSON.stringify({}) } })
    expect(await dependencyFuneralScanner.run(empty)).toHaveLength(0)
  })
})
