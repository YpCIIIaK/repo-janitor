import { describe, it, expect } from "vitest"
import { dependencyFuneralScanner } from "../../src/index"
import { makeContext } from "../helpers"

const reg = (name: string) => `https://registry.npmjs.org/${name}`
const threeYearsAgo = new Date(Date.now() - 3.2 * 365 * 24 * 3600 * 1000).toISOString()
const twoYearsAgo = new Date(Date.now() - 2.5 * 365 * 24 * 3600 * 1000).toISOString()
const oneYearAgo = new Date(Date.now() - 1 * 365 * 24 * 3600 * 1000).toISOString()

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

  it("does not flag framework-implicit runtimes (react-dom) as unused", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { "react-dom": "19.0.0" } }) },
    })
    expect(await dependencyFuneralScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag a dep referenced only by an npm script", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          dependencies: { vitest: "2.0.0" },
          scripts: { test: "vitest run" },
        }),
      },
    })
    expect(await dependencyFuneralScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag a dep referenced only in a config file", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { autoprefixer: "10.0.0" } }),
        "postcss.config.mjs": "export default { plugins: { autoprefixer: {} } }\n",
      },
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

  it("warns on a long-abandoned package (3+ years since last release)", async () => {
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
    expect(issues.find((i) => i.id === "dep-abandoned-old")?.severity).toBe("warning")
  })

  it("downgrades a 2-3 year publish gap to info (likely feature-complete)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { stable: "1.0.0" } }),
        "a.ts": "import 'stable'\n",
      },
      fetchJson: {
        [reg("stable")]: {
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": {} },
          time: { "1.0.0": twoYearsAgo },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.find((i) => i.id === "dep-abandoned-stable")?.severity).toBe("info")
  })

  /**
   * Regression guard for a real false positive: the scanner called `clsx`
   * abandoned. clsx is 8 KB pulled 445M times a month — it is finished, not dead.
   * Branding packages like that is how a scanner loses its reader.
   */
  describe("abandonment is qualified by size and reach", () => {
    const dl = (p: string) => `https://api.npmjs.org/downloads/point/last-month/${p}`

    it("says nothing about a tiny, heavily-used package that stopped releasing", async () => {
      const ctx = makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { clsx: "2.1.1" } }),
          "a.ts": "import 'clsx'\n",
        },
        fetchJson: {
          [reg("clsx")]: {
            "dist-tags": { latest: "2.1.1" },
            versions: { "2.1.1": { dist: { unpackedSize: 8555 } } },
            time: { "2.1.1": threeYearsAgo },
          },
          [dl("clsx")]: { downloads: 445_050_433 },
        },
      })
      const issues = await dependencyFuneralScanner.run(ctx)
      expect(issues.some((i) => i.id === "dep-abandoned-clsx")).toBe(false)
    })

    it("keeps a soft note for a large, heavily-used package with a stalled cadence", async () => {
      const ctx = makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { big: "1.0.0" } }),
          "a.ts": "import 'big'\n",
        },
        fetchJson: {
          [reg("big")]: {
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { dist: { unpackedSize: 4_000_000 } } },
            time: { "1.0.0": threeYearsAgo },
          },
          [dl("big")]: { downloads: 50_000_000 },
        },
      })
      const issues = await dependencyFuneralScanner.run(ctx)
      const found = issues.find((i) => i.id === "dep-abandoned-big")
      expect(found?.severity).toBe("info") // demoted from warning by reach alone
      expect(found?.detail).toContain("50,000,000 downloads a month")
    })

    it("still warns on a tiny package nobody uses", async () => {
      const ctx = makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { obscure: "1.0.0" } }),
          "a.ts": "import 'obscure'\n",
        },
        fetchJson: {
          [reg("obscure")]: {
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { dist: { unpackedSize: 4000 } } },
            time: { "1.0.0": threeYearsAgo },
          },
          [dl("obscure")]: { downloads: 120 },
        },
      })
      const issues = await dependencyFuneralScanner.run(ctx)
      expect(issues.find((i) => i.id === "dep-abandoned-obscure")?.severity).toBe("warning")
    })

    it("falls back to the age-only rule when download data is unavailable", async () => {
      const ctx = makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { unknown: "1.0.0" } }),
          "a.ts": "import 'unknown'\n",
        },
        fetchJson: {
          [reg("unknown")]: {
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { dist: { unpackedSize: 4000 } } },
            time: { "1.0.0": threeYearsAgo },
          },
          // no downloads endpoint → null
        },
      })
      const issues = await dependencyFuneralScanner.run(ctx)
      const found = issues.find((i) => i.id === "dep-abandoned-unknown")
      expect(found?.severity).toBe("warning")
      expect(found?.detail).not.toContain("downloads a month")
    })

    it("does not let reach mask an explicitly deprecated package", async () => {
      const ctx = makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { gone: "1.0.0" } }),
          "a.ts": "import 'gone'\n",
        },
        fetchJson: {
          [reg("gone")]: {
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { deprecated: "use x", dist: { unpackedSize: 900 } } },
            time: { "1.0.0": threeYearsAgo },
          },
          [dl("gone")]: { downloads: 90_000_000 },
        },
      })
      const issues = await dependencyFuneralScanner.run(ctx)
      expect(issues.find((i) => i.id === "dep-deprecated-gone")?.severity).toBe("warning")
    })
  })

  it("does not flag a package published within the last 2 years", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { fresh: "1.0.0" } }),
        "a.ts": "import 'fresh'\n",
      },
      fetchJson: {
        [reg("fresh")]: {
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": {} },
          time: { "1.0.0": oneYearAgo },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.some((i) => i.id === "dep-abandoned-fresh")).toBe(false)
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

  it("does NOT flag a caret range that already auto-accepts the newer minor", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { car: "^2.0.0" } }),
        "a.ts": "import 'car'\n",
      },
      fetchJson: {
        [reg("car")]: {
          "dist-tags": { latest: "2.5.0" },
          versions: { "2.5.0": {} },
          time: { "2.5.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.some((i) => i.id === "dep-outdated-car")).toBe(false)
  })

  it("flags a caret range that is behind by a MAJOR (caret can't cross it)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { car: "^1.2.0" } }),
        "a.ts": "import 'car'\n",
      },
      fetchJson: {
        [reg("car")]: {
          "dist-tags": { latest: "3.0.0" },
          versions: { "3.0.0": {} },
          time: { "3.0.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.find((i) => i.id === "dep-outdated-car")?.severity).toBe("warning")
  })

  it("flags a tilde range behind by a minor (tilde only accepts patches)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { til: "~2.0.0" } }),
        "a.ts": "import 'til'\n",
      },
      fetchJson: {
        [reg("til")]: {
          "dist-tags": { latest: "2.5.0" },
          versions: { "2.5.0": {} },
          time: { "2.5.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.find((i) => i.id === "dep-outdated-til")?.severity).toBe("info")
  })

  it("skips the outdated check for non-comparable ranges (>=, *, x)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { open: ">=1.0.0" } }),
        "a.ts": "import 'open'\n",
      },
      fetchJson: {
        [reg("open")]: {
          "dist-tags": { latest: "3.0.0" },
          versions: { "3.0.0": {} },
          time: { "3.0.0": new Date().toISOString() },
        },
      },
    })
    const issues = await dependencyFuneralScanner.run(ctx)
    expect(issues.some((i) => i.id === "dep-outdated-open")).toBe(false)
  })

  it("returns nothing when package.json is absent or has no deps", async () => {
    expect(await dependencyFuneralScanner.run(makeContext({ files: {} }))).toHaveLength(0)
    const empty = makeContext({ files: { "package.json": JSON.stringify({}) } })
    expect(await dependencyFuneralScanner.run(empty)).toHaveLength(0)
  })
})
