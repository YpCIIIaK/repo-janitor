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
const OSV_BATCH_MAX = 1000 // OSV querybatch accepts up to 1000 queries per request
const MAX_QUERIES = 6000 // overall ceiling so a giant lockfile can't spam OSV

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
  /** declared directly in the manifest (false = pulled in transitively) */
  direct: boolean
}

/**
 * Enumerate EVERY installed npm package (direct + transitive) with its exact
 * version from a committed lockfile, so `npm audit`-style transitive
 * vulnerabilities are caught — not just the handful in package.json. Returns null
 * when no recognized npm lockfile is present, signalling the caller to fall back
 * to declared-only floors.
 */
async function enumerateNpmInstalled(
  ctx: ScanContext,
  fileSet: Set<string>,
): Promise<Map<string, { version: string; dev: boolean }> | null> {
  const installed = new Map<string, { version: string; dev: boolean }>()
  let sawLockfile = false

  const add = (name: string, version: string, dev: boolean) => {
    if (!name || !version) return
    const existing = installed.get(name)
    // Prefer a non-dev record if we see the same package both ways.
    if (!existing) installed.set(name, { version, dev })
    else if (existing.dev && !dev) installed.set(name, { version: existing.version, dev: false })
  }

  // package-lock.json / npm-shrinkwrap.json — structured JSON, most reliable.
  for (const lf of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fileSet.has(lf)) continue
    const txt = await ctx.readFile(lf)
    if (!txt) continue
    sawLockfile = true
    try {
      const json = JSON.parse(txt) as {
        packages?: Record<string, { version?: string; dev?: boolean }>
        dependencies?: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }>
      }
      // npm v7+: flat `packages` map keyed by install path; every node_modules
      // entry (nested or not) is an installed package.
      for (const [key, val] of Object.entries(json.packages ?? {})) {
        const m = key.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
        if (m && typeof val?.version === "string") add(m[1], val.version, val.dev === true)
      }
      // npm v6: nested `dependencies` tree — walk it depth-first.
      const walk = (deps: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }> | undefined) => {
        for (const [name, val] of Object.entries(deps ?? {})) {
          if (typeof val?.version === "string") add(name, val.version, val.dev === true)
          walk(val?.dependencies as typeof deps)
        }
      }
      walk(json.dependencies)
    } catch {
      /* malformed lockfile — try the next source */
    }
  }

  // pnpm-lock.yaml — enumerate every `packages:` entry key. Handles both the
  // leading-slash form (`/name@1.2.3:`) and the slashless v9 form (`name@1.2.3:`).
  if (fileSet.has("pnpm-lock.yaml")) {
    const txt = await ctx.readFile("pnpm-lock.yaml")
    if (txt) {
      sawLockfile = true
      const re = /(?:^|\n) {2,}\/?((?:@[^/\s@]+\/)?[^/\s@]+)@(\d+\.\d+\.\d+[^\s:(]*)(?:\([^)]*\))?:/g
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) add(m[1], m[2], false)
    }
  }

  // yarn.lock — each block header `name@range:` is followed by `version "x"`.
  if (fileSet.has("yarn.lock")) {
    const txt = await ctx.readFile("yarn.lock")
    if (txt) {
      sawLockfile = true
      const re = /(?:^|\n)"?((?:@[^/\s@]+\/)?[^@\s,"]+)@[^\n]*(?:,[^\n]*)*\n(?:[^\n]*\n)*?\s+version:?\s+"?(\d+\.\d+\.\d+[^\s"]*)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) add(m[1], m[2], false)
    }
  }

  return sawLockfile ? installed : null
}

export const vulnerableDepsScanner: Scanner = {
  id: "vulnerable-deps",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    if (!ctx.postJson) return [] // offline → no vulnerability data available

    const queryList: QueryItem[] = []

    // 1) npm — resolve exact versions from package.json + JS lockfiles.
    const fileSet = new Set(ctx.files)
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
        const declaredNames = new Set(Object.keys(declared))
        // Prefer the FULL installed tree from a lockfile (transitive included,
        // like `npm audit`); fall back to declared-only floors with no lockfile.
        const installed = await enumerateNpmInstalled(ctx, fileSet)
        if (installed) {
          for (const [name, { version, dev }] of installed) {
            queryList.push({
              ecosystem: "npm",
              name,
              version,
              manifest: "package.json",
              dev: dev || devNames.has(name),
              direct: declaredNames.has(name),
            })
          }
        } else if (Object.keys(declared).length > 0) {
          const versions = await resolveVersions(ctx, declared)
          for (const [name, version] of versions) {
            queryList.push({ ecosystem: "npm", name, version, manifest: "package.json", dev: devNames.has(name), direct: true })
          }
        }
      } catch {
        /* malformed package.json — skip the npm part, still check other manifests */
      }
    }

    // 2) Polyglot — Python / Go / Rust / Ruby manifests & lockfiles.
    for (const d of await collectManifestDeps(ctx)) {
      queryList.push({ ecosystem: d.ecosystem, name: d.name, version: d.version, manifest: d.manifest, dev: false, direct: true })
    }

    if (queryList.length === 0) return []
    if (queryList.length > MAX_QUERIES) queryList.length = MAX_QUERIES

    // Batch the (possibly large, transitive) set in OSV-sized chunks and
    // concatenate the results so they stay aligned with the query order.
    const results: NonNullable<OsvBatchResponse["results"]> = []
    for (let i = 0; i < queryList.length; i += OSV_BATCH_MAX) {
      const chunk = queryList.slice(i, i + OSV_BATCH_MAX)
      const batch = (await ctx.postJson(OSV_BATCH_URL, {
        queries: chunk.map((q) => ({ package: { ecosystem: q.ecosystem, name: q.name }, version: q.version })),
      })) as OsvBatchResponse | null
      if (!batch?.results) return [] // network failure or unexpected shape → degrade quietly
      results.push(...batch.results)
    }

    // Collect hits, aligned to the query order.
    const hits: (QueryItem & { vulnId: string })[] = []
    results.forEach((res, i) => {
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
      const kindNote = hit.direct
        ? hit.dev
          ? " (dev dependency)"
          : ""
        : " (transitive dependency)"
      const detail =
        `${summary ? `${summary} ` : ""}${hit.name}@${hit.version} (${hit.ecosystem}) is affected by ${id}` +
        `${label ? ` (${label.toLowerCase()} severity)` : ""}. ${fixHint}` +
        `${kindNote} Advisory: https://osv.dev/${hit.vulnId}`

      issues.push({
        id: `vuln-${hit.name}-${hit.vulnId}`,
        category: "security",
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
