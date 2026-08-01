import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * License Risk scanner ⭐.
 *
 * Reads the licenses of the project's direct dependencies and reports the ones
 * that impose obligations the project itself has not taken on.
 *
 * This is the only finding in the whole tool that can end a transaction rather
 * than cost engineering time. Nobody walks away from a repository because of
 * dead code; a single AGPL dependency in a product about to be sold is a lawyer's
 * finding, and it is invisible in every code review because the offending line is
 * one word in a file nobody opens.
 *
 * ## The question is compatibility, not virtue
 *
 * A GPL dependency is not a defect. It is a defect *relative to* a project that
 * ships under something else — and perfectly fine in a project that is itself
 * GPL. So the first thing this scanner does is establish what the project claims
 * for itself, and everything after that is a comparison. A copyleft repository
 * gets no copyleft findings at all.
 *
 * Two more rules keep it from moralising:
 *
 *  1. **Direct dependencies only.** A transitive GPL package deep in the tree is
 *     a real question, but it is not one this scanner can answer honestly — the
 *     obligation depends on linkage and distribution, and the reader cannot act
 *     on a name they have never heard of. Direct deps are the set someone chose.
 *  2. **Dev dependencies are not shipped.** A GPL build tool does not reach the
 *     customer. It is worth knowing and it is not the same fact, so it drops to
 *     info — collapsing the two would put a red badge on half of npm, since
 *     plenty of excellent tooling is copyleft.
 *
 * Nothing here is legal advice, and the detail text says so. The scanner reports
 * what the manifests declare; what follows from that is a lawyer's call.
 */

/** Cap on registry lookups, so a large manifest cannot turn into a long scan. */
const MAX_LOOKUPS = 60

/** Cap on reported findings. */
const MAX_ISSUES = 25

export type LicenseClass =
  /** Obligations trigger on network use, not just distribution — AGPL, SSPL. */
  | "network-copyleft"
  /** Obligations cover the whole derived work — GPL. */
  | "strong-copyleft"
  /** Obligations cover the library's own files — LGPL, MPL, EPL, CDDL. */
  | "weak-copyleft"
  /** Attribution and little else — MIT, BSD, Apache, ISC. */
  | "permissive"
  /** Explicitly not open source: "UNLICENSED", "SEE LICENSE IN …", proprietary. */
  | "proprietary"
  /** Nothing declared, or a string that cannot be resolved to any of the above. */
  | "unknown"

/**
 * How restrictive each class is, for resolving SPDX expressions.
 *
 * `unknown` deliberately sorts above `permissive` and below the copyleft
 * families: an undeclared license is a question, not an accusation.
 */
const RANK: Record<LicenseClass, number> = {
  permissive: 0,
  unknown: 1,
  "weak-copyleft": 2,
  proprietary: 3,
  "strong-copyleft": 4,
  "network-copyleft": 5,
}

/** SPDX id prefixes by class. Matched case-insensitively, longest first. */
const PREFIXES: [string, LicenseClass][] = [
  ["agpl", "network-copyleft"],
  ["sspl", "network-copyleft"],
  ["osl", "network-copyleft"],
  ["lgpl", "weak-copyleft"],
  ["gpl", "strong-copyleft"],
  ["mpl", "weak-copyleft"],
  ["epl", "weak-copyleft"],
  ["eupl", "weak-copyleft"],
  ["cddl", "weak-copyleft"],
  ["cecill", "strong-copyleft"],
  ["cpl", "weak-copyleft"],
  ["ms-rl", "weak-copyleft"],
  ["mit", "permissive"],
  ["bsd", "permissive"],
  ["apache", "permissive"],
  ["isc", "permissive"],
  ["0bsd", "permissive"],
  ["unlicense", "permissive"],
  ["cc0", "permissive"],
  // Share-alike is copyleft; plain attribution is not. Listed in this order
  // only for readability — the matcher sorts by length, so "cc-by-sa" wins
  // over "cc-by" regardless. caniuse-lite alone puts CC-BY-4.0 into a large
  // share of the JS ecosystem's dependency trees, and calling that
  // "undeclared" would have been simply untrue.
  ["cc-by-sa", "weak-copyleft"],
  ["cc-by", "permissive"],
  ["wtfpl", "permissive"],
  ["zlib", "permissive"],
  ["python-2", "permissive"],
  ["postgresql", "permissive"],
  ["artistic", "weak-copyleft"],
  ["blueoak", "permissive"],
  ["ms-pl", "permissive"],
  ["unlicensed", "proprietary"],
  ["proprietary", "proprietary"],
  ["commercial", "proprietary"],
  ["see license", "proprietary"],
  ["nonstandard", "unknown"],
]

/** One SPDX identifier (no operators) → its class. */
function classifyAtom(id: string): LicenseClass {
  const s = id.trim().toLowerCase().replace(/^\(|\)$/g, "")
  if (!s) return "unknown"
  // Longest prefix wins so "lgpl" is not read as "gpl" and "unlicensed"
  // (proprietary, npm's marker for private packages) is not read as "unlicense"
  // (permissive, a real public-domain dedication). Those two differ by one
  // letter and by everything else.
  const hit = [...PREFIXES]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([p]) => s.startsWith(p))
  return hit ? hit[1] : "unknown"
}

/**
 * An SPDX expression → the class the project actually has to live with.
 *
 * `OR` is a choice offered TO the user, so the least restrictive option wins:
 * "MIT OR GPL-2.0" can be taken as MIT and imposes nothing. `AND` is a set of
 * obligations that all apply, so the most restrictive wins. Getting this
 * backwards would flag half of the Perl-descended ecosystem, which is dual
 * licensed precisely so that nobody has to take the GPL side.
 */
export function classifyLicense(expr: string | null | undefined): LicenseClass {
  if (!expr || typeof expr !== "string") return "unknown"
  const norm = expr.trim()
  if (!norm) return "unknown"

  const orParts = norm.split(/\s+OR\s+/i)
  if (orParts.length > 1) {
    return orParts
      .map((p) => classifyLicense(p))
      .reduce((best, c) => (RANK[c] < RANK[best] ? c : best))
  }

  const andParts = norm.split(/\s+AND\s+/i)
  if (andParts.length > 1) {
    return andParts
      .map((p) => classifyLicense(p))
      .reduce((worst, c) => (RANK[c] > RANK[worst] ? c : worst))
  }

  return classifyAtom(norm)
}

/**
 * npm allows `license` to be a string, a legacy `{ type }` object, or a legacy
 * `licenses` array. All three still appear in packages published years ago,
 * which are exactly the packages a decay scanner meets.
 */
export function readDeclaredLicense(pkg: unknown): string | null {
  if (!pkg || typeof pkg !== "object") return null
  const p = pkg as {
    license?: unknown
    licenses?: unknown
  }
  if (typeof p.license === "string") return p.license
  if (p.license && typeof p.license === "object") {
    const t = (p.license as { type?: unknown }).type
    if (typeof t === "string") return t
  }
  if (Array.isArray(p.licenses)) {
    const types = p.licenses
      .map((l) => (typeof l === "string" ? l : (l as { type?: unknown })?.type))
      .filter((t): t is string => typeof t === "string")
    if (types.length) return types.join(" AND ")
  }
  return null
}

export interface DepLicense {
  name: string
  license: string | null
  klass: LicenseClass
  /** Declared under `dependencies` rather than `devDependencies`. */
  shipped: boolean
  /** Where the license text was read from, named in the finding. */
  source: string
}

/**
 * The verdict for one dependency, given the project's own license class.
 *
 * Exported and pure: this table IS the scanner, and every row of it is a claim
 * about what a reader should do, so each wants a test of its own.
 */
export function assess(
  project: LicenseClass,
  dep: DepLicense,
): { severity: Severity; kind: string } | null {
  const { klass, shipped } = dep

  if (klass === "permissive") return null

  // A copyleft project has already accepted these terms; the whole point of
  // GPL-on-GPL is that it composes. Saying anything here would be scolding a
  // maintainer for being consistent.
  const projectIsCopyleft =
    project === "strong-copyleft" || project === "network-copyleft" || project === "weak-copyleft"

  if (klass === "unknown") {
    // Not an accusation — a gap. Somebody has to look it up by hand, and that
    // is worth one line, once. Two different gaps, though: nothing declared at
    // all, and something declared that this scanner does not recognise. Saying
    // "no license" about a package that states one is just false, and the
    // reader would be right to stop trusting the rest of the report.
    return { severity: "info", kind: dep.license ? "unrecognised" : "unknown" }
  }

  if (klass === "proprietary") {
    // Private/internal packages are normal in a company monorepo; the finding
    // is that redistribution is not permitted, which only matters downstream.
    return { severity: shipped ? "warning" : "info", kind: "proprietary" }
  }

  if (projectIsCopyleft) return null

  if (klass === "weak-copyleft") {
    return shipped ? { severity: "info", kind: "weak" } : null
  }

  if (klass === "network-copyleft") {
    // The one that ends deals: obligations trigger on running the software as a
    // service, which is exactly what most of these projects do.
    return { severity: shipped ? "critical" : "info", kind: "network" }
  }

  // strong-copyleft
  return { severity: shipped ? "warning" : "info", kind: "strong" }
}

const CLASS_LABEL: Record<LicenseClass, string> = {
  "network-copyleft": "network copyleft",
  "strong-copyleft": "strong copyleft",
  "weak-copyleft": "weak copyleft",
  permissive: "permissive",
  proprietary: "proprietary",
  unknown: "undeclared",
}

/** Standard disclaimer, appended to every detail. This is not legal advice. */
const NOT_ADVICE =
  "This is what the package manifest declares, not a legal opinion — whether an " +
  "obligation actually applies depends on how the code is linked and distributed."

function describe(
  dep: DepLicense,
  verdict: { severity: Severity; kind: string },
  projectLicense: string | null,
): { title: string; detail: string } {
  const where = dep.shipped ? "a runtime dependency" : "a dev dependency"
  const mine = projectLicense ? `this project ships under ${projectLicense}` : "this project"

  switch (verdict.kind) {
    case "network":
      return {
        title: `${dep.name} is ${dep.license} — network copyleft in ${where}`,
        detail:
          `${dep.name} is licensed ${dep.license}, while ${mine}. Unlike the GPL, its obligations are ` +
          `triggered by letting users interact with the software over a network, not only by shipping ` +
          `binaries — so running it inside a hosted product can require releasing the source of that ` +
          `product. This is the single most common finding to surface late in an acquisition. ` +
          `${dep.shipped ? "" : "It is a dev dependency here, so it is not distributed with your code. "}` +
          NOT_ADVICE,
      }
    case "strong":
      return {
        title: `${dep.name} is ${dep.license} — copyleft in ${where}`,
        detail:
          `${dep.name} is licensed ${dep.license}, while ${mine}. The GPL family asks that works derived ` +
          `from it be released under the same terms, which is incompatible with distributing a closed ` +
          `product built on top of it. ` +
          `${dep.shipped ? "" : "As a dev dependency it is not shipped, which is usually the end of it. "}` +
          NOT_ADVICE,
      }
    case "weak":
      return {
        title: `${dep.name} is ${dep.license} — file-level copyleft`,
        detail:
          `${dep.name} is licensed ${dep.license}. Obligations here are limited to the library's own ` +
          `files: modifications to it must be published, but your code around it need not be. Usually ` +
          `fine, and worth knowing before someone patches it in place. ` + NOT_ADVICE,
      }
    case "proprietary":
      return {
        title: `${dep.name} declares no open-source license`,
        detail:
          `${dep.name} declares "${dep.license}", which grants no redistribution rights by default. If ` +
          `it is an internal package that is expected; if it came from a registry, somebody agreed to ` +
          `terms that are not in this repository. ` + NOT_ADVICE,
      }
    case "unrecognised":
      return {
        title: `${dep.name} declares a license this scanner does not know: ${dep.license}`,
        detail:
          `${dep.name} declares "${dep.license}" (read from ${dep.source}), which is not one of the ` +
          `families this scanner classifies. It may well be fine — the point is that nobody can tell ` +
          `from the report, so it wants one manual look. ` + NOT_ADVICE,
      }
    default:
      return {
        title: `${dep.name} declares no license at all`,
        detail:
          `No license field was found for ${dep.name} (read from ${dep.source}). Code with no stated ` +
          `license is not public domain — by default nobody has permission to redistribute it. Most of ` +
          `the time this is an oversight upstream and the answer is in the repository; it needs looking ` +
          `up by hand once. ` + NOT_ADVICE,
      }
  }
}

/** Sniff a license from LICENSE file text, for repos that ship no manifest field. */
export function licenseFromText(text: string): string | null {
  const head = text.slice(0, 4000)
  const patterns: [RegExp, string][] = [
    [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
    [/Server Side Public License/i, "SSPL-1.0"],
    [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL-3.0"],
    [/GNU GENERAL PUBLIC LICENSE/i, "GPL-3.0"],
    [/Mozilla Public License/i, "MPL-2.0"],
    [/Eclipse Public License/i, "EPL-2.0"],
    [/Apache License/i, "Apache-2.0"],
    [/\bMIT License\b/i, "MIT"],
    [/Redistribution and use in source and binary forms/i, "BSD-3-Clause"],
    [/ISC License/i, "ISC"],
  ]
  for (const [re, id] of patterns) if (re.test(head)) return id
  return null
}

/** Root LICENSE file, whatever it is called. */
function rootLicenseFile(files: string[]): string | null {
  return (
    files.find((f) => !f.includes("/") && /^licen[sc]e(\.(md|txt))?$/i.test(f)) ?? null
  )
}

export const licenseRiskScanner: Scanner = {
  id: "license-risk",
  category: "dependency",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const raw = await ctx.readFile("package.json")
    if (!raw) return []

    let pkgJson: {
      license?: unknown
      licenses?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      private?: boolean
    }
    try {
      pkgJson = JSON.parse(raw)
    } catch {
      return []
    }

    // --- what the project claims for itself ---------------------------------
    let projectLicense = readDeclaredLicense(pkgJson)
    if (!projectLicense) {
      const lic = rootLicenseFile(ctx.files)
      if (lic) {
        const text = await ctx.readFile(lic)
        if (text) projectLicense = licenseFromText(text)
      }
    }
    const projectClass = classifyLicense(projectLicense)

    const prod = Object.keys(pkgJson.dependencies ?? {})
    const dev = Object.keys(pkgJson.devDependencies ?? {})
    const names = [...prod, ...new Set(dev.filter((d) => !prod.includes(d)))]
    if (names.length === 0) return []

    const shippedSet = new Set(prod)
    const issues: Issue[] = []
    let lookups = 0

    for (const name of names.slice(0, 300)) {
      if (issues.length >= MAX_ISSUES) break

      // Installed copy first: it is exact, it is offline, and it is the version
      // actually in use rather than whatever the registry publishes today.
      let license: string | null = null
      let source = ""
      const installed = await ctx.readFile(`node_modules/${name}/package.json`)
      if (installed) {
        try {
          license = readDeclaredLicense(JSON.parse(installed))
          source = `node_modules/${name}/package.json`
        } catch {
          /* an unreadable installed manifest is not this scanner's finding */
        }
      }

      if (license === null && !installed) {
        if (!ctx.fetchJson || lookups >= MAX_LOOKUPS) continue
        lookups++
        const data = await ctx.fetchJson(`https://registry.npmjs.org/${name}`)
        if (!data) continue
        license = readDeclaredLicense(data)
        source = "the npm registry"
        // A registry record with no license at all is far more often a fetch
        // that returned something unexpected than a package that truly declares
        // none. Only the installed copy is trusted to prove an absence.
        if (license === null) continue
      }

      const dep: DepLicense = {
        name,
        license,
        klass: classifyLicense(license),
        shipped: shippedSet.has(name),
        source: source || "package.json",
      }
      const verdict = assess(projectClass, dep)
      if (!verdict) continue

      const { title, detail } = describe(dep, verdict, projectLicense)
      issues.push({
        id: `license-${verdict.kind}-${name}`,
        category: "dependency",
        severity: verdict.severity,
        title,
        location: "package.json",
        ageDays: 0,
        detail,
        evidence: `${name}: ${dep.license ?? "(no license field)"} — ${CLASS_LABEL[dep.klass]}`,
      })
    }

    return issues
  },
}
