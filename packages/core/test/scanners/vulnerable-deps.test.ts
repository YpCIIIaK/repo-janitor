import { describe, it, expect } from "vitest"
import { vulnerableDepsScanner } from "../../src/index"
import { makeContext } from "../helpers"

const BATCH_URL = "https://api.osv.dev/v1/querybatch"
const VULN_URL = "https://api.osv.dev/v1/vulns/"

describe("vulnerableDepsScanner", () => {
  it("is a no-op when there is no network adapter (offline)", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.20" } }) },
    })
    expect(await vulnerableDepsScanner.run(ctx)).toHaveLength(0)
  })

  it("reports a vulnerable npm package with mapped severity and fixed version", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.20" } }) },
      postJson: {
        [BATCH_URL]: { results: [{ vulns: [{ id: "GHSA-xxxx" }] }] },
      },
      fetchJson: {
        [`${VULN_URL}GHSA-xxxx`]: {
          id: "GHSA-xxxx",
          summary: "Prototype pollution",
          aliases: ["CVE-2021-23337"],
          database_specific: { severity: "HIGH" },
          affected: [
            {
              package: { ecosystem: "npm", name: "lodash" },
              ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
            },
          ],
        },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].category).toBe("dependency")
    expect(issues[0].severity).toBe("critical") // HIGH → critical
    expect(issues[0].title).toContain("CVE-2021-23337") // CVE alias preferred
    expect(issues[0].detail).toContain("Fixed in 4.17.21")
    expect(issues[0].location).toBe("package.json")
  })

  it("reports nothing when OSV returns no vulns", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { ok: "1.0.0" } }) },
      postJson: { [BATCH_URL]: { results: [{ vulns: [] }] } },
    })
    expect(await vulnerableDepsScanner.run(ctx)).toHaveLength(0)
  })

  it("maps MODERATE to warning and falls back to warning on unknown label", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { a: "1.0.0", b: "2.0.0" } }) },
      postJson: {
        [BATCH_URL]: { results: [{ vulns: [{ id: "V-A" }] }, { vulns: [{ id: "V-B" }] }] },
      },
      fetchJson: {
        [`${VULN_URL}V-A`]: {
          id: "V-A",
          database_specific: { severity: "MODERATE" },
          affected: [{ package: { ecosystem: "npm", name: "a" } }],
        },
        [`${VULN_URL}V-B`]: {
          id: "V-B",
          affected: [{ package: { ecosystem: "npm", name: "b" } }],
        },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    const a = issues.find((i) => i.id === "vuln-a-V-A")
    const b = issues.find((i) => i.id === "vuln-b-V-B")
    expect(a?.severity).toBe("warning")
    expect(b?.severity).toBe("warning") // unknown severity → warning, never dropped
  })

  it("prefers the exact installed version from package-lock.json", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
        "package-lock.json": JSON.stringify({
          packages: { "node_modules/lodash": { version: "4.17.20" } },
        }),
      },
      postJson: { [BATCH_URL]: { results: [{ vulns: [{ id: "V" }] }] } },
      fetchJson: {
        [`${VULN_URL}V`]: { id: "V", affected: [{ package: { ecosystem: "npm", name: "lodash" } }] },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues[0].title).toContain("lodash@4.17.20") // resolved from lockfile, not ^4.0.0
  })
})
