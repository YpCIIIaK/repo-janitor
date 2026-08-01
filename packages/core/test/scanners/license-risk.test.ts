import { describe, it, expect } from "vitest"
import {
  classifyLicense,
  readDeclaredLicense,
  licenseFromText,
  assess,
  licenseRiskScanner,
  type DepLicense,
  type LicenseClass,
} from "../../src/scanners/license-risk"
import type { ScanContext } from "../../src/scanner"

describe("classifyLicense", () => {
  it("reads the permissive family", () => {
    for (const id of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "0BSD", "CC0-1.0"]) {
      expect(classifyLicense(id)).toBe("permissive")
    }
  })

  it("separates the copyleft families", () => {
    expect(classifyLicense("GPL-3.0-only")).toBe("strong-copyleft")
    expect(classifyLicense("AGPL-3.0")).toBe("network-copyleft")
    expect(classifyLicense("SSPL-1.0")).toBe("network-copyleft")
    expect(classifyLicense("LGPL-2.1")).toBe("weak-copyleft")
    expect(classifyLicense("MPL-2.0")).toBe("weak-copyleft")
  })

  it("does not read LGPL as GPL", () => {
    // A prefix match that took the shorter string would move every LGPL library
    // into the family with the strongest obligations.
    expect(classifyLicense("LGPL-3.0-or-later")).toBe("weak-copyleft")
  })

  it("distinguishes Unlicense from UNLICENSED", () => {
    // One letter apart, opposite meanings: a public-domain dedication versus
    // npm's marker for a package nobody may redistribute.
    expect(classifyLicense("Unlicense")).toBe("permissive")
    expect(classifyLicense("UNLICENSED")).toBe("proprietary")
  })

  it("takes the least restrictive side of an OR", () => {
    // The choice is offered to the user, so a dual-licensed package imposes the
    // terms of whichever side they take.
    expect(classifyLicense("MIT OR GPL-2.0")).toBe("permissive")
    expect(classifyLicense("(MIT OR Apache-2.0)")).toBe("permissive")
  })

  it("takes the most restrictive side of an AND", () => {
    expect(classifyLicense("MIT AND GPL-3.0")).toBe("strong-copyleft")
  })

  it("reads the Creative Commons pair on the right sides", () => {
    // caniuse-lite is CC-BY-4.0 and sits under a large share of the JS
    // ecosystem; attribution is not copyleft, share-alike is.
    expect(classifyLicense("CC-BY-4.0")).toBe("permissive")
    expect(classifyLicense("CC-BY-SA-4.0")).toBe("weak-copyleft")
  })

  it("treats nothing and nonsense as unknown", () => {
    expect(classifyLicense(null)).toBe("unknown")
    expect(classifyLicense("")).toBe("unknown")
    expect(classifyLicense("Buy me a beer")).toBe("unknown")
  })
})

describe("readDeclaredLicense", () => {
  it("reads a plain string", () => {
    expect(readDeclaredLicense({ license: "MIT" })).toBe("MIT")
  })

  it("reads the legacy object form", () => {
    expect(readDeclaredLicense({ license: { type: "ISC", url: "x" } })).toBe("ISC")
  })

  it("reads the legacy array form", () => {
    // Still present in packages published a decade ago — which is exactly the
    // population a decay scanner runs into.
    expect(readDeclaredLicense({ licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] })).toBe(
      "MIT AND GPL-2.0",
    )
  })

  it("returns null when nothing is declared", () => {
    expect(readDeclaredLicense({ name: "x" })).toBeNull()
    expect(readDeclaredLicense(null)).toBeNull()
  })
})

describe("licenseFromText", () => {
  it("recognises the AGPL header", () => {
    expect(licenseFromText("   GNU AFFERO GENERAL PUBLIC LICENSE\n Version 3")).toBe("AGPL-3.0")
  })

  it("does not read the LGPL header as GPL", () => {
    expect(licenseFromText("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1")).toBe("LGPL-3.0")
  })

  it("recognises the MIT text", () => {
    expect(licenseFromText("MIT License\n\nCopyright (c) 2024")).toBe("MIT")
  })

  it("returns null for a licence it does not know", () => {
    expect(licenseFromText("Do what you want, I am not your dad.")).toBeNull()
  })
})

describe("assess", () => {
  const dep = (over: Partial<DepLicense>): DepLicense => ({
    name: "x",
    license: "MIT",
    klass: "permissive",
    shipped: true,
    source: "node_modules/x/package.json",
    ...over,
  })

  it("says nothing about a permissive dependency", () => {
    expect(assess("permissive", dep({}))).toBeNull()
  })

  it("calls AGPL in a shipped dependency critical", () => {
    expect(assess("permissive", dep({ klass: "network-copyleft" }))?.severity).toBe("critical")
  })

  it("drops AGPL in a dev dependency to info", () => {
    // A build tool is not distributed. Treating the two the same would put a red
    // badge on a great deal of perfectly ordinary tooling.
    expect(assess("permissive", dep({ klass: "network-copyleft", shipped: false }))?.severity).toBe(
      "info",
    )
  })

  it("says nothing about copyleft in a copyleft project", () => {
    // GPL-on-GPL is the point of the GPL. Reporting it would be scolding a
    // maintainer for being consistent.
    for (const project of ["strong-copyleft", "network-copyleft"] as LicenseClass[]) {
      expect(assess(project, dep({ klass: "strong-copyleft" }))).toBeNull()
      expect(assess(project, dep({ klass: "network-copyleft" }))).toBeNull()
    }
  })

  it("still reports a proprietary dependency in a copyleft project", () => {
    // "No redistribution rights" is a fact about the package, not a comparison
    // with the project's own terms.
    expect(assess("strong-copyleft", dep({ klass: "proprietary" }))?.severity).toBe("warning")
  })

  it("reports weak copyleft only when shipped, and only as info", () => {
    expect(assess("permissive", dep({ klass: "weak-copyleft" }))?.severity).toBe("info")
    expect(assess("permissive", dep({ klass: "weak-copyleft", shipped: false }))).toBeNull()
  })

  it("reports an undeclared license as a gap, not an accusation", () => {
    expect(assess("permissive", dep({ klass: "unknown", license: null }))).toMatchObject({
      severity: "info",
      kind: "unknown",
    })
  })

  it("separates 'nothing declared' from 'declared something I do not know'", () => {
    // Saying "no license" about a package that states one is simply false, and
    // a reader who spots it is right to distrust the rest of the report.
    expect(assess("permissive", dep({ klass: "unknown", license: "Beerware" }))).toMatchObject({
      kind: "unrecognised",
    })
  })
})

describe("licenseRiskScanner", () => {
  const ctx = (files: Record<string, string>, fetchJson?: ScanContext["fetchJson"]): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      fetchJson,
      git: { blameAgeDays: async () => 0, listBranches: async () => [] },
      log: () => {},
    }) as unknown as ScanContext

  const installed = (name: string, license: unknown) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, license }),
  })

  it("says nothing about an all-permissive tree", async () => {
    const issues = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({
          license: "MIT",
          dependencies: { react: "^19.0.0", zod: "^3.0.0" },
        }),
        ...installed("react", "MIT"),
        ...installed("zod", "MIT"),
      }),
    )
    expect(issues).toEqual([])
  })

  it("reports an AGPL runtime dependency as critical", async () => {
    const [issue] = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({ license: "MIT", dependencies: { grafana: "1.0.0" } }),
        ...installed("grafana", "AGPL-3.0-only"),
      }),
    )
    expect(issue.severity).toBe("critical")
    expect(issue.title).toMatch(/network copyleft/)
    expect(issue.detail).toMatch(/not a legal opinion/)
  })

  it("stays quiet when the project is itself AGPL", async () => {
    const issues = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({ license: "AGPL-3.0", dependencies: { grafana: "1.0.0" } }),
        ...installed("grafana", "AGPL-3.0-only"),
      }),
    )
    expect(issues).toEqual([])
  })

  it("reads the project's license from its LICENSE file when the manifest omits it", async () => {
    const issues = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({ dependencies: { thing: "1.0.0" } }),
        LICENSE: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
        ...installed("thing", "GPL-3.0"),
      }),
    )
    expect(issues).toEqual([])
  })

  it("prefers the installed copy over the registry", async () => {
    let called = false
    const issues = await licenseRiskScanner.run(
      ctx(
        {
          "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }),
          ...installed("thing", "MIT"),
        },
        async () => {
          called = true
          return { license: "AGPL-3.0" }
        },
      ),
    )
    expect(called).toBe(false)
    expect(issues).toEqual([])
  })

  it("falls back to the registry when nothing is installed", async () => {
    const [issue] = await licenseRiskScanner.run(
      ctx(
        { "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }) },
        async () => ({ license: "GPL-3.0" }),
      ),
    )
    expect(issue.severity).toBe("warning")
    expect(issue.evidence).toMatch(/strong copyleft/)
  })

  it("says nothing at all with no network and nothing installed", async () => {
    // Offline is silence, not guesswork.
    const issues = await licenseRiskScanner.run(
      ctx({ "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }) }),
    )
    expect(issues).toEqual([])
  })

  it("does not treat a registry record with no license as an absence", async () => {
    // A missing field over the wire is much more often an odd response than a
    // package that genuinely declares nothing; only an installed copy proves it.
    const issues = await licenseRiskScanner.run(
      ctx(
        { "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }) },
        async () => ({ name: "thing" }),
      ),
    )
    expect(issues).toEqual([])
  })

  it("reports an installed package with no license field", async () => {
    const [issue] = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }),
        ...installed("thing", undefined),
      }),
    )
    expect(issue.severity).toBe("info")
    expect(issue.title).toMatch(/no license at all/)
  })

  it("names the license it could not place", async () => {
    const [issue] = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({ license: "MIT", dependencies: { thing: "1.0.0" } }),
        ...installed("thing", "Beerware"),
      }),
    )
    expect(issue.title).toMatch(/does not know: Beerware/)
  })

  it("does not double-report a package listed in both dependency groups", async () => {
    const issues = await licenseRiskScanner.run(
      ctx({
        "package.json": JSON.stringify({
          license: "MIT",
          dependencies: { thing: "1.0.0" },
          devDependencies: { thing: "1.0.0" },
        }),
        ...installed("thing", "GPL-3.0"),
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
  })

  it("survives a malformed package.json", async () => {
    expect(await licenseRiskScanner.run(ctx({ "package.json": "{ nope" }))).toEqual([])
  })

  it("does nothing in a repository with no package.json", async () => {
    expect(await licenseRiskScanner.run(ctx({ "README.md": "# hi" }))).toEqual([])
  })
})
