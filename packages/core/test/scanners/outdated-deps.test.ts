import { describe, it, expect } from "vitest"
import { outdatedDepsScanner } from "../../src/index"
import { makeContext } from "../helpers"

const pypi = (name: string) => `https://pypi.org/pypi/${name}/json`
const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString()

describe("outdatedDepsScanner", () => {
  it("is a no-op when offline (no fetchJson)", async () => {
    const ctx = makeContext({ files: { "requirements.txt": "requests==2.0.0\n" } })
    expect(await outdatedDepsScanner.run(ctx)).toHaveLength(0)
  })

  it("flags a major-behind PyPI dependency as warning", async () => {
    const ctx = makeContext({
      files: { "requirements.txt": "requests==2.0.0\n" },
      fetchJson: {
        [pypi("requests")]: {
          info: { version: "3.1.0" },
          urls: [{ upload_time_iso_8601: new Date().toISOString() }],
        },
      },
    })
    const issues = await outdatedDepsScanner.run(ctx)
    const outdated = issues.find((i) => i.id === "dep-outdated-pypi-requests")
    expect(outdated?.severity).toBe("warning")
    expect(outdated?.title).toContain("3.1.0")
    expect(outdated?.location).toBe("requirements.txt")
  })

  it("flags an abandoned dependency (no release in 2+ years)", async () => {
    const ctx = makeContext({
      files: { "requirements.txt": "oldlib==1.0.0\n" },
      fetchJson: {
        [pypi("oldlib")]: {
          info: { version: "1.0.0" },
          urls: [{ upload_time_iso_8601: threeYearsAgo }],
        },
      },
    })
    const issues = await outdatedDepsScanner.run(ctx)
    expect(issues.some((i) => i.id === "dep-abandoned-pypi-oldlib")).toBe(true)
  })

  it("reports nothing when up to date", async () => {
    const ctx = makeContext({
      files: { "requirements.txt": "fresh==2.0.0\n" },
      fetchJson: {
        [pypi("fresh")]: {
          info: { version: "2.0.0" },
          urls: [{ upload_time_iso_8601: new Date().toISOString() }],
        },
      },
    })
    expect(await outdatedDepsScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores npm deps (handled by dependency-funeral)", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "1.0.0" } }) },
      fetchJson: {},
    })
    expect(await outdatedDepsScanner.run(ctx)).toHaveLength(0)
  })
})
