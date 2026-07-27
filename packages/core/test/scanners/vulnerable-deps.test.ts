import { describe, it, expect } from "vitest"
import { vulnerableDepsScanner, computeScore, scoreToGrade } from "../../src/index"
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
    expect(issues[0].category).toBe("security")
    expect(issues[0].severity).toBe("critical") // HIGH on a direct prod dep → critical
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

  it("flags a TRANSITIVE vulnerable package from package-lock.json (not in package.json)", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { app: "1.0.0" } }),
        "package-lock.json": JSON.stringify({
          packages: {
            "": { name: "root" },
            "node_modules/app": { version: "1.0.0" },
            "node_modules/badlib": { version: "2.0.0" }, // pulled in transitively by app
          },
        }),
      },
      // query order follows lockfile enumeration: [app, badlib]
      postJson: { [BATCH_URL]: { results: [{ vulns: [] }, { vulns: [{ id: "V" }] }] } },
      fetchJson: {
        [`${VULN_URL}V`]: { id: "V", affected: [{ package: { ecosystem: "npm", name: "badlib" } }] },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe("vuln-badlib-V")
    expect(issues[0].title).toContain("badlib@2.0.0")
    expect(issues[0].detail).toContain("(transitive dependency)")
  })

  it("enumerates the full tree from pnpm-lock.yaml", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ dependencies: { app: "^1.0.0" } }),
        "pnpm-lock.yaml":
          "packages:\n" +
          "  /app@1.0.0:\n    resolution: {integrity: aaa}\n" +
          "  /badlib@2.0.0:\n    resolution: {integrity: bbb}\n",
      },
      postJson: { [BATCH_URL]: { results: [{ vulns: [] }, { vulns: [{ id: "V" }] }] } },
      fetchJson: {
        [`${VULN_URL}V`]: { id: "V", affected: [{ package: { ecosystem: "npm", name: "badlib" } }] },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("badlib@2.0.0")
    expect(issues[0].detail).toContain("(transitive dependency)")
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

/**
 * Regression guard from the first real run of the published package: scanning a
 * repo pinned to lodash 4.17.20 listed CVE-2021-23337 twice and CVE-2025-13465
 * twice. The GitHub advisory database carries duplicate rows aliasing one CVE,
 * and dedup keyed on the OSV id let both through.
 */
describe("vulnerableDepsScanner — duplicate advisory rows", () => {
  it("reports one finding per CVE even when two GHSA rows alias it", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.20" } }) },
      postJson: {
        [BATCH_URL]: { results: [{ vulns: [{ id: "GHSA-aaaa" }, { id: "GHSA-bbbb" }] }] },
      },
      fetchJson: {
        [`${VULN_URL}GHSA-aaaa`]: {
          id: "GHSA-aaaa",
          aliases: ["CVE-2021-23337"],
          database_specific: { severity: "MODERATE" },
          affected: [{ package: { ecosystem: "npm", name: "lodash" } }],
        },
        [`${VULN_URL}GHSA-bbbb`]: {
          id: "GHSA-bbbb",
          aliases: ["CVE-2021-23337"], // same CVE, different advisory row
          database_specific: { severity: "HIGH" },
          affected: [{ package: { ecosystem: "npm", name: "lodash" } }],
        },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe("vuln-lodash-CVE-2021-23337")
    // The rows disagreed; the worse one wins — under-reporting costs more.
    expect(issues[0].severity).toBe("critical")
  })

  it("still reports genuinely different CVEs on the same package separately", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { lodash: "4.17.20" } }) },
      postJson: {
        [BATCH_URL]: { results: [{ vulns: [{ id: "GHSA-aaaa" }, { id: "GHSA-cccc" }] }] },
      },
      fetchJson: {
        [`${VULN_URL}GHSA-aaaa`]: {
          id: "GHSA-aaaa",
          aliases: ["CVE-2021-23337"],
          affected: [{ package: { ecosystem: "npm", name: "lodash" } }],
        },
        [`${VULN_URL}GHSA-cccc`]: {
          id: "GHSA-cccc",
          aliases: ["CVE-2020-28500"],
          affected: [{ package: { ecosystem: "npm", name: "lodash" } }],
        },
      },
    })
    const issues = await vulnerableDepsScanner.run(ctx)
    expect(issues.map((i) => i.id).sort()).toEqual([
      "vuln-lodash-CVE-2020-28500",
      "vuln-lodash-CVE-2021-23337",
    ])
  })
})

/**
 * Severity calibration. These are the false positives that cost the tool its
 * credibility on first run: a HIGH advisory scored as CRITICAL, and a build-only
 * package dragging the grade down for code that never ships.
 */
describe("vulnerableDepsScanner — severity calibration", () => {
  /** app is a prod dep; eslint is dev and pulls brace-expansion transitively. */
  const PNPM_WORKSPACE_LOCK = [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      app:",
    "        specifier: ^1.0.0",
    "        version: 1.0.0",
    "    devDependencies:",
    "      eslint:",
    "        specifier: ^9.0.0",
    "        version: 9.0.0",
    "",
    "snapshots:",
    "",
    "  app@1.0.0: {}",
    "",
    "  eslint@9.0.0:",
    "    dependencies:",
    "      brace-expansion: 1.0.0",
    "",
    "  brace-expansion@1.0.0: {}",
    "",
  ].join("\n")

  /** query order follows lockfile enumeration: app, eslint, brace-expansion */
  function workspaceContext(results: { vulns?: { id: string }[] }[], vulns: Record<string, unknown>) {
    return makeContext({
      files: {
        "package.json": JSON.stringify({
          dependencies: { app: "^1.0.0" },
          devDependencies: { eslint: "^9.0.0" },
        }),
        "pnpm-lock.yaml": PNPM_WORKSPACE_LOCK,
      },
      postJson: { [BATCH_URL]: { results } },
      fetchJson: vulns,
    })
  }

  it("keeps HIGH below CRITICAL on a transitive package", async () => {
    const ctx = makeContext({
      files: { "package.json": JSON.stringify({ dependencies: { app: "1.0.0" } }) },
      postJson: { [BATCH_URL]: { results: [{ vulns: [{ id: "V" }] }] } },
      fetchJson: {
        [`${VULN_URL}V`]: {
          id: "V",
          database_specific: { severity: "HIGH" },
          affected: [{ package: { ecosystem: "npm", name: "app" } }],
        },
      },
    })
    const direct = await vulnerableDepsScanner.run(ctx)
    expect(direct[0].severity).toBe("critical") // direct prod dep = demonstrated runtime path

    // Same advisory, but reached transitively — no proven runtime path.
    const transitive = await vulnerableDepsScanner.run(
      makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { app: "1.0.0" } }),
          "package-lock.json": JSON.stringify({
            packages: { "node_modules/app": { version: "1.0.0" }, "node_modules/deep": { version: "2.0.0" } },
          }),
        },
        postJson: { [BATCH_URL]: { results: [{ vulns: [] }, { vulns: [{ id: "V" }] }] } },
        fetchJson: {
          [`${VULN_URL}V`]: {
            id: "V",
            database_specific: { severity: "HIGH" },
            affected: [{ package: { ecosystem: "npm", name: "deep" } }],
          },
        },
      }),
    )
    expect(transitive[0].severity).toBe("warning")
  })

  it("lowers severity for packages reachable only through devDependencies", async () => {
    const issues = await vulnerableDepsScanner.run(
      workspaceContext(
        [{ vulns: [] }, { vulns: [{ id: "V-ESLINT" }] }, { vulns: [{ id: "V-BRACE" }] }],
        {
          [`${VULN_URL}V-ESLINT`]: {
            id: "V-ESLINT",
            database_specific: { severity: "CRITICAL" },
            affected: [{ package: { ecosystem: "npm", name: "eslint" } }],
          },
          [`${VULN_URL}V-BRACE`]: {
            id: "V-BRACE",
            database_specific: { severity: "HIGH" },
            affected: [{ package: { ecosystem: "npm", name: "brace-expansion" } }],
          },
        },
      ),
    )
    const eslint = issues.find((i) => i.id === "vuln-eslint-V-ESLINT")
    const brace = issues.find((i) => i.id === "vuln-brace-expansion-V-BRACE")
    expect(eslint?.severity).toBe("warning") // CRITICAL, but build-only → one step down
    expect(brace?.severity).toBe("info") // HIGH, transitive, build-only
    expect(brace?.detail).toContain("Build/test-only path")
  })

  it("does NOT grade a repo F when every CVE is dev-only", async () => {
    // Ten critical advisories, all reachable only through eslint.
    const results = [{ vulns: [] }, { vulns: [] }, { vulns: Array.from({ length: 10 }, (_, i) => ({ id: `V${i}` })) }]
    const vulns: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) {
      vulns[`${VULN_URL}V${i}`] = {
        id: `V${i}`,
        database_specific: { severity: "CRITICAL" },
        affected: [{ package: { ecosystem: "npm", name: "brace-expansion" } }],
      }
    }
    const issues = await vulnerableDepsScanner.run(workspaceContext(results, vulns))
    expect(issues).toHaveLength(10)
    expect(issues.every((i) => i.severity === "warning")).toBe(true)

    const grade = scoreToGrade(computeScore(issues))
    expect(grade).not.toBe("F")
  })

  it("treats a package in both dependencies and devDependencies as production", async () => {
    const issues = await vulnerableDepsScanner.run(
      makeContext({
        files: {
          "package.json": JSON.stringify({ dependencies: { app: "1.0.0" }, devDependencies: { app: "1.0.0" } }),
        },
        postJson: { [BATCH_URL]: { results: [{ vulns: [{ id: "V" }] }] } },
        fetchJson: {
          [`${VULN_URL}V`]: {
            id: "V",
            database_specific: { severity: "CRITICAL" },
            affected: [{ package: { ecosystem: "npm", name: "app" } }],
          },
        },
      }),
    )
    expect(issues[0].severity).toBe("critical")
  })
})
