import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { collectDirectDeps, type ManifestDep, type OsvEcosystem } from "../manifests"

/**
 * Outdated / Abandoned Dependencies scanner (polyglot, non-npm).
 *
 * Complements `dependency-funeral` (npm only) by checking PyPI, crates.io,
 * RubyGems and Go modules against their public registries — no API key needed:
 *  - **outdated**  — behind the latest release by a major (warning) or minor (info)
 *  - **abandoned** — latest release is over two years old (warning), where the
 *    registry exposes a publish date (PyPI, crates.io, Go; RubyGems' single-call
 *    endpoint has no date, so it's outdated-only).
 *
 * Only **direct** deps are checked (one network call each), capped at
 * {@link MAX_DEPS}. Needs `ctx.fetchJson`; offline it is a no-op.
 */

const ABANDONED_MS = 2 * 365 * 24 * 60 * 60 * 1000
const MAX_DEPS = 100
const CONCURRENCY = 6

interface RegInfo {
  latest?: string
  lastPublishMs?: number
}

interface SemVer {
  major: number
  minor: number
  patch: number
}

function parseSemver(v: string | undefined): SemVer | null {
  const m = (v ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0 }
}

function toMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : undefined
}

// ---- per-ecosystem registry lookups ---------------------------------------

async function lookupPyPI(ctx: ScanContext, name: string): Promise<RegInfo | null> {
  const data = (await ctx.fetchJson?.(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)) as
    | { info?: { version?: string }; urls?: { upload_time_iso_8601?: string }[]; releases?: Record<string, { upload_time_iso_8601?: string }[]> }
    | null
  if (!data?.info?.version) return null
  const latest = data.info.version
  const files = data.urls?.length ? data.urls : data.releases?.[latest]
  return { latest, lastPublishMs: toMs(files?.[0]?.upload_time_iso_8601) }
}

async function lookupCrates(ctx: ScanContext, name: string): Promise<RegInfo | null> {
  const data = (await ctx.fetchJson?.(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`)) as
    | { crate?: { max_stable_version?: string; newest_version?: string; updated_at?: string } }
    | null
  const crate = data?.crate
  if (!crate) return null
  return { latest: crate.max_stable_version ?? crate.newest_version, lastPublishMs: toMs(crate.updated_at) }
}

async function lookupRubyGems(ctx: ScanContext, name: string): Promise<RegInfo | null> {
  const data = (await ctx.fetchJson?.(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`)) as
    | { version?: string }
    | null
  if (!data?.version) return null
  return { latest: data.version } // this endpoint carries no publish date
}

/** Escape a Go module path for the proxy: uppercase X → "!x". */
function escapeGoModule(path: string): string {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)
}

async function lookupGo(ctx: ScanContext, name: string): Promise<RegInfo | null> {
  const data = (await ctx.fetchJson?.(`https://proxy.golang.org/${escapeGoModule(name)}/@latest`)) as
    | { Version?: string; Time?: string }
    | null
  if (!data?.Version) return null
  return { latest: data.Version.replace(/^v/, ""), lastPublishMs: toMs(data.Time) }
}

async function lookupPackagist(ctx: ScanContext, name: string): Promise<RegInfo | null> {
  // Packagist's p2 metadata uses the bare "vendor/package" path (keep the slash).
  const data = (await ctx.fetchJson?.(`https://repo.packagist.org/p2/${name}.json`)) as
    | { packages?: Record<string, { version?: string; time?: string }[]> }
    | null
  const versions = data?.packages?.[name]
  if (!versions?.length) return null
  return { latest: versions[0].version?.replace(/^v/, ""), lastPublishMs: toMs(versions[0].time) }
}

const LOOKUPS: Record<OsvEcosystem, ((ctx: ScanContext, name: string) => Promise<RegInfo | null>) | undefined> = {
  npm: undefined, // handled by dependency-funeral
  PyPI: lookupPyPI,
  "crates.io": lookupCrates,
  RubyGems: lookupRubyGems,
  Go: lookupGo,
  Packagist: lookupPackagist,
}

/** Short, id-safe ecosystem key. */
const ECO_KEY: Record<OsvEcosystem, string> = {
  npm: "npm",
  PyPI: "pypi",
  "crates.io": "crates",
  RubyGems: "rubygems",
  Go: "go",
  Packagist: "packagist",
}

/** Run an async mapper over items with a fixed concurrency limit. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function issuesFor(dep: ManifestDep, info: RegInfo): Issue[] {
  const issues: Issue[] = []
  const ekey = ECO_KEY[dep.ecosystem]

  // abandoned (only where a date is available)
  if (info.lastPublishMs && Date.now() - info.lastPublishMs > ABANDONED_MS) {
    const years = Math.floor((Date.now() - info.lastPublishMs) / (365 * 24 * 60 * 60 * 1000))
    issues.push({
      id: `dep-abandoned-${ekey}-${dep.name}`,
      category: "dependency",
      severity: "warning",
      title: `${dep.name} looks abandoned (no ${dep.ecosystem} release in ${years}+ years)`,
      location: dep.manifest,
      ageDays: 0,
      detail: `${dep.name} has not published a new version on ${dep.ecosystem} in over ${years} years. It may be unmaintained.`,
    })
  }

  // outdated
  const current = parseSemver(dep.version)
  const latest = parseSemver(info.latest)
  if (current && latest && info.latest) {
    let severity: Severity | null = null
    let kind = ""
    if (latest.major > current.major) {
      severity = "warning"
      kind = "major"
    } else if (latest.major === current.major && latest.minor > current.minor) {
      severity = "info"
      kind = "minor"
    }
    if (severity) {
      issues.push({
        id: `dep-outdated-${ekey}-${dep.name}`,
        category: "dependency",
        severity,
        title: `${dep.name} is ${kind} versions behind (${current.major}.${current.minor} → ${info.latest})`,
        location: dep.manifest,
        ageDays: 0,
        detail: `${dep.name} is at ${dep.version} but the latest on ${dep.ecosystem} is ${info.latest}. A ${kind} upgrade is available.`,
      })
    }
  }

  return issues
}

export const outdatedDepsScanner: Scanner = {
  id: "outdated-deps",
  category: "dependency",
  async run(ctx: ScanContext): Promise<Issue[]> {
    if (!ctx.fetchJson) return [] // offline → no registry data

    const deps = (await collectDirectDeps(ctx)).filter((d) => LOOKUPS[d.ecosystem]).slice(0, MAX_DEPS)
    if (deps.length === 0) return []

    const results = await mapLimit(deps, CONCURRENCY, async (dep) => {
      const lookup = LOOKUPS[dep.ecosystem]
      const info = lookup ? await lookup(ctx, dep.name) : null
      return info ? issuesFor(dep, info) : []
    })

    return results.flat()
  },
}
