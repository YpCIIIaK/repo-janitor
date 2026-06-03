import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { parseFile, walk } from "../ast"

/**
 * Dependency Funeral scanner ⭐.
 *
 * Detects dependencies that are:
 *  - **unused**     — declared in `dependencies` but never imported (AST-based, like env scanner)
 *  - **deprecated** — npm-deprecated latest version (registry)
 *  - **abandoned**  — no publish in over two years (registry)
 *  - **outdated**   — behind latest by a major (warning) or minor (info) version (registry)
 *
 * Registry lookups go through the optional `ctx.fetchJson`. With no network adapter
 * the scanner runs offline: it still reports unused deps from static analysis and
 * skips the registry-derived findings.
 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
const ABANDONED_MS = 2 * 365 * 24 * 60 * 60 * 1000

interface SemVer {
  major: number
  minor: number
  patch: number
}

function parseSemver(v: string | undefined): SemVer | null {
  const m = (v ?? "").match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3] }
}

/** Normalize an import specifier to its package name, or null for local imports. */
function packageOf(spec: string): string | null {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return null
  const clean = spec.replace(/^node:/, "")
  if (spec.startsWith("@")) {
    const parts = clean.split("/")
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  return clean.split("/")[0]
}

/** Collect every package name imported/required across the source tree. */
async function collectImports(ctx: ScanContext): Promise<Set<string>> {
  const used = new Set<string>()
  for (const file of ctx.files) {
    if (!SOURCE_RE.test(file)) continue
    const content = await ctx.readFile(file)
    if (!content) continue
    const ast = parseFile(content, file)
    if (!ast) continue

    walk(ast, (node) => {
      let spec: string | null = null
      if (
        (node.type === "ImportDeclaration" ||
          node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        node.source
      ) {
        spec = (node.source as { value?: string }).value ?? null
      } else if (node.type === "CallExpression") {
        const callee = node.callee as { type?: string; name?: string }
        const isRequire = callee?.type === "Identifier" && callee.name === "require"
        const isDynamicImport = callee?.type === "Import"
        if (isRequire || isDynamicImport) {
          const arg = (node.arguments as { type?: string; value?: string }[] | undefined)?.[0]
          if (arg?.type === "StringLiteral") spec = arg.value ?? null
        }
      }
      const pkg = spec ? packageOf(spec) : null
      if (pkg) used.add(pkg)
    })
  }
  return used
}

interface RegistryInfo {
  latest?: string
  deprecated: boolean
  lastPublishMs?: number
}

/** Look up registry metadata for a package; null when offline or on failure. */
async function lookup(ctx: ScanContext, pkg: string): Promise<RegistryInfo | null> {
  if (!ctx.fetchJson) return null
  const data = (await ctx.fetchJson(`https://registry.npmjs.org/${pkg}`)) as
    | {
        "dist-tags"?: { latest?: string }
        versions?: Record<string, { deprecated?: string }>
        time?: Record<string, string>
      }
    | null
  if (!data) return null

  const latest = data["dist-tags"]?.latest
  const deprecated = !!(latest && data.versions?.[latest]?.deprecated)
  const stamp = (latest && data.time?.[latest]) || data.time?.modified
  const lastPublishMs = stamp ? new Date(stamp).getTime() : undefined
  return { latest, deprecated, lastPublishMs }
}

export const dependencyFuneralScanner: Scanner = {
  id: "dependency-funeral",
  category: "dependency",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const raw = await ctx.readFile("package.json")
    if (!raw) return []

    let pkgJson: { dependencies?: Record<string, string> }
    try {
      pkgJson = JSON.parse(raw)
    } catch {
      return [] // malformed package.json — nothing reliable to report
    }
    const deps = pkgJson.dependencies ?? {}
    const names = Object.keys(deps)
    if (names.length === 0) return []

    const issues: Issue[] = []
    const used = await collectImports(ctx)

    for (const name of names) {
      // 1) unused (static, works offline) — @types/* are never imported directly
      if (!used.has(name) && !name.startsWith("@types/")) {
        issues.push({
          id: `dep-unused-${name}`,
          category: "dependency",
          severity: "info",
          title: `${name} is installed but never imported`,
          location: "package.json",
          ageDays: 0,
          detail: `${name} is declared in dependencies but no import/require references it. Consider removing it.`,
        })
      }

      // 2) registry-derived findings (skipped offline)
      const info = await lookup(ctx, name)
      if (!info) continue

      if (info.deprecated) {
        issues.push({
          id: `dep-deprecated-${name}`,
          category: "dependency",
          severity: "warning",
          title: `${name} is deprecated`,
          location: "package.json",
          ageDays: 0,
          detail: `The latest published version of ${name} is marked deprecated on npm. Plan a migration.`,
        })
      } else if (info.lastPublishMs && Date.now() - info.lastPublishMs > ABANDONED_MS) {
        const years = Math.floor((Date.now() - info.lastPublishMs) / (365 * 24 * 60 * 60 * 1000))
        issues.push({
          id: `dep-abandoned-${name}`,
          category: "dependency",
          severity: "warning",
          title: `${name} looks abandoned (no release in ${years}+ years)`,
          location: "package.json",
          ageDays: 0,
          detail: `${name} has not published a new version in over ${years} years. It may be unmaintained.`,
        })
      }

      // 3) outdated: compare declared range base to latest
      const current = parseSemver(deps[name])
      const latest = parseSemver(info.latest)
      if (current && latest) {
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
            id: `dep-outdated-${name}`,
            category: "dependency",
            severity,
            title: `${name} is ${kind} versions behind (${current.major}.${current.minor} → ${info.latest})`,
            location: "package.json",
            ageDays: 0,
            detail: `Declared ${deps[name]} but latest is ${info.latest}. A ${kind} upgrade is available.`,
          })
        }
      }
    }

    return issues
  },
}
