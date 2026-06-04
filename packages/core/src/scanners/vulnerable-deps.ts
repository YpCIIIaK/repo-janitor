import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { collectManifestDeps, type OsvEcosystem } from "../manifests"

/**
 * Vulnerable Dependencies scanner ⭐.
 *
 * Cross-references the project's dependencies against the public OSV database
 * (https://osv.dev) and reports packages with known security advisories (CVEs /
 * GHSAs). OSV needs no API key. Polyglot: npm, PyPI, Go, crates.io, RubyGems and
 * Packagist are all checked in one batch, so Python/Go/Rust/Ruby/PHP repos get
 * real findings too — not just npm projects.
 *
 * Versions are resolved as precisely as possible:
 *  1. exact installed version from a committed lockfile (package-lock.json,
 *     pnpm-lock.yaml, yarn.lock, poetry.lock, Pipfile.lock, Cargo.lock,
 *     Gemfile.lock), else
 *  2. the floor of the declared range in the manifest (package.json,
 *     requirements.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile).
 *
 * The whole dependency set is checked in a single `querybatch` POST; advisory
 * details are then fetched only for the (usually few) packages that actually
 * matched, keeping the network cost to ~1 request for a clean repo.
 *
 * Needs `ctx.postJson` (POST). With no network adapter the scanner is a no-op.
 */

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns/"
const MAX_DETAILS = 60 // cap advisory-detail fetches so a pathological repo can't spam OSV

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]

interface OsvBatchResponse {
  results?: { vulns?: { id: string }[] }[]
}

interface OsvVuln {
  id: string
  summary?: string
  aliases?: string[]
  severity?: { type?: string; score?: string }[]
  database_specific?: { severity?: string }
  affected?: {
    package?: { ecosystem?: string; name?: string }
    ranges?: { type?: string; events?: { introduced?: string; fixed?: string }[] }[]
    database_specific?: { severity?: string }
  }[]
}

/** Strip a semver range down to its base version, e.g. "^1.2.3" → "1.2.3". */
function rangeFloor(range: string | undefined): string | null {
  const m = (range ?? "").match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)
  return m ? m[1] : null
}

/** Escape a package name for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Resolve the exact installed version for each package from committed lockfiles,
 * falling back to the declared range floor. Returns a map name → version.
 */
async function resolveVersions(
  ctx: ScanContext,
  declared: Record<string, string>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const names = Object.keys(declared)
  const fileSet = new Set(ctx.files)

  // 1) package-lock.json / npm-shrinkwrap.json — structured JSON, most reliable.
  for (const lf of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fileSet.has(lf)) continue
    const txt = await ctx.readFile(lf)
    if (!txt) continue
    try {
      const json = JSON.parse(txt) as {
        packages?: Record<string, { version?: string }>
        dependencies?: Record<string, { version?: string }>
      }
      // npm v7+: keyed by "node_modules/<name>" (top-level wins for our purpose).
      for (const [key, val] of Object.entries(json.packages ?? {})) {
        const m = key.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/)
        if (m && typeof val?.version === "string" && !resolved.has(m[1])) {
          resolved.set(m[1], val.version)
        }
      }
      // npm v6: flat map keyed by name.
      for (const [name, val] of Object.entries(json.dependencies ?? {})) {
        if (typeof val?.version === "string" && !resolved.has(name)) {
          resolved.set(name, val.version)
        }
      }
    } catch {
      /* malformed lockfile — fall through to other sources */
    }
  }

  // 2) pnpm-lock.yaml — match "/<name>@<version>" or "/<name>/<version>" entries.
  if (fileSet.has("pnpm-lock.yaml")) {
    const txt = await ctx.readFile("pnpm-lock.yaml")
    if (txt) {
      for (const name of names) {
        if (resolved.has(name)) continue
        const re = new RegExp(`(?:^|\\n)\\s*['"]?/?${escapeRe(name)}[@/](\\d+\\.\\d+\\.\\d+[^\\s:'"()]*)`)
        const m = txt.match(re)
        if (m) resolved.set(name, m[1])
      }
    }
  }

  // 3) yarn.lock — find the block header for the package, then its `version "x"`.
  if (fileSet.has("yarn.lock")) {
    const txt = await ctx.readFile("yarn.lock")
    if (txt) {
      for (const name of names) {
        if (resolved.has(name)) continue
        const re = new RegExp(
          `(?:^|\\n)"?${escapeRe(name)}@[^\\n]*\\n(?:[^\\n]*\\n)*?\\s+version:?\\s+"?(\\d+\\.\\d+\\.\\d+[^\\s"]*)`,
        )
        const m = txt.match(re)
        if (m) resolved.set(name, m[1])
      }
    }
  }

  // 4) Fallback: declared range floor from package.json.
  for (const name of names) {
    if (resolved.has(name)) continue
    const floor = rangeFloor(declared[name])
    if (floor) resolved.set(name, floor)
  }

  return resolved
}

/** Map an OSV/GHSA severity label to our three-level scale. */
function mapSeverity(label: string | undefined): Severity {
  switch ((label ?? "").toUpperCase()) {
    case "CRITICAL":
    case "HIGH":
      return "critical"
    case "MODERATE":
    case "MEDIUM":
      return "warning"
    case "LOW":
      return "info"
    default:
      // It is still a real, confirmed vulnerability — never silently drop it.
      return "warning"
  }
}

/** Pick the human severity label OSV exposes (top-level first, then per-affected). */
function severityLabel(vuln: OsvVuln): string | undefined {
  return vuln.database_specific?.severity ?? vuln.affected?.[0]?.database_specific?.severity
}

/** First published fixed version for the given package, if any. */
function fixedVersion(vuln: OsvVuln, ecosystem: OsvEcosystem, name: string): string | null {
  for (const aff of vuln.affected ?? []) {
    if (aff.package?.ecosystem !== ecosystem || aff.package?.name !== name) continue
    for (const range of aff.ranges ?? []) {
      for (const ev of range.events ?? []) {
        if (ev.fixed) return ev.fixed
      }
    }
  }
  return null
}

/** Prefer a CVE alias for display; fall back to the OSV/GHSA id. */
function displayId(vuln: OsvVuln): string {
  return (vuln.aliases ?? []).find((a) => a.startsWith("CVE-")) ?? vuln.id
}

interface QueryItem {
  ecosystem: OsvEcosystem
  name: string
  version: string
  /** manifest the dependency was declared in — becomes the finding location */
  manifest: string
  /** npm dev dependency (other ecosystems: always false — not tracked) */
  dev: boolean
}

export const vulnerableDepsScanner: Scanner = {
  id: "vulnerable-deps",
  category: "dependency",
  async run(ctx: ScanContext): Promise<Issue[]> {
    if (!ctx.postJson) return [] // offline → no vulnerability data available

    const queryList: QueryItem[] = []

    // 1) npm — resolve exact versions from package.json + JS lockfiles.
    const raw = await ctx.readFile("package.json")
    if (raw) {
      try {
        const pkgJson = JSON.parse(raw) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
          optionalDependencies?: Record<string, string>
        }
        const declared: Record<string, string> = {
          ...(pkgJson.dependencies ?? {}),
          ...(pkgJson.devDependencies ?? {}),
          ...(pkgJson.optionalDependencies ?? {}),
        }
        const devNames = new Set(Object.keys(pkgJson.devDependencies ?? {}))
        if (Object.keys(declared).length > 0) {
          const versions = await resolveVersions(ctx, declared)
          for (const [name, version] of versions) {
            queryList.push({ ecosystem: "npm", name, version, manifest: "package.json", dev: devNames.has(name) })
          }
        }
      } catch {
        /* malformed package.json — skip the npm part, still check other manifests */
      }
    }

    // 2) Polyglot — Python / Go / Rust / Ruby manifests & lockfiles.
    for (const d of await collectManifestDeps(ctx)) {
      queryList.push({ ecosystem: d.ecosystem, name: d.name, version: d.version, manifest: d.manifest, dev: false })
    }

    if (queryList.length === 0) return []

    // One batch request for the whole (polyglot) dependency set.
    const batch = (await ctx.postJson(OSV_BATCH_URL, {
      queries: queryList.map((q) => ({ package: { ecosystem: q.ecosystem, name: q.name }, version: q.version })),
    })) as OsvBatchResponse | null
    if (!batch?.results) return [] // network failure or unexpected shape → degrade quietly

    // Collect hits, aligned to the query order.
    const hits: (QueryItem & { vulnId: string })[] = []
    batch.results.forEach((res, i) => {
      const q = queryList[i]
      if (!q) return
      for (const v of res.vulns ?? []) {
        if (v?.id) hits.push({ ...q, vulnId: v.id })
      }
    })
    if (hits.length === 0) return []

    // Fetch advisory details once per unique vuln id (GET → ctx.fetchJson).
    const details = new Map<string, OsvVuln | null>()
    const uniqueIds = [...new Set(hits.map((h) => h.vulnId))].slice(0, MAX_DETAILS)
    await Promise.all(
      uniqueIds.map(async (id) => {
        const v = ctx.fetchJson
          ? ((await ctx.fetchJson(`${OSV_VULN_URL}${encodeURIComponent(id)}`)) as OsvVuln | null)
          : null
        details.set(id, v)
      }),
    )

    const issues: Issue[] = []
    const seen = new Set<string>()
    for (const hit of hits) {
      const key = `${hit.name}::${hit.vulnId}`
      if (seen.has(key)) continue // one finding per package+advisory
      seen.add(key)

      const vuln = details.get(hit.vulnId)
      const label = vuln ? severityLabel(vuln) : undefined
      const id = vuln ? displayId(vuln) : hit.vulnId
      const summary = vuln?.summary?.trim()
      const fixed = vuln ? fixedVersion(vuln, hit.ecosystem, hit.name) : null

      const fixHint = fixed
        ? `Fixed in ${fixed} — upgrade to ${fixed} or later.`
        : "No fixed version has been published yet."
      const detail =
        `${summary ? `${summary} ` : ""}${hit.name}@${hit.version} (${hit.ecosystem}) is affected by ${id}` +
        `${label ? ` (${label.toLowerCase()} severity)` : ""}. ${fixHint}` +
        `${hit.dev ? " (dev dependency)" : ""} Advisory: https://osv.dev/${hit.vulnId}`

      issues.push({
        id: `vuln-${hit.name}-${hit.vulnId}`,
        category: "dependency",
        severity: mapSeverity(label),
        title: `${hit.name}@${hit.version} has a known vulnerability (${id})`,
        location: hit.manifest,
        ageDays: 0,
        detail,
      })
    }

    return issues
  },
}
