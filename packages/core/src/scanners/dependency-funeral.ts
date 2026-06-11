import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { parseFile, walk } from "../ast"

/**
 * Dependency Funeral scanner ⭐.
 *
 * Detects dependencies that are:
 *  - **unused**     — declared in `dependencies` but never imported (AST-based, like env scanner)
 *  - **deprecated** — npm-deprecated latest version (registry)
 *  - **abandoned**  — no publish in 2-3 years (info) or 3+ years (warning) (registry)
 *  - **outdated**   — behind latest by a major (warning) or minor (info) version (registry)
 *
 * Registry lookups go through the optional `ctx.fetchJson`. With no network adapter
 * the scanner runs offline: it still reports unused deps from static analysis and
 * skips the registry-derived findings.
 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
const YEAR_MS = 365 * 24 * 60 * 60 * 1000
// A 2-year publish gap is a soft note (many micro-libs are simply feature-complete);
// only a 3+ year gap is loud enough to call a likely-unmaintained risk.
const ABANDONED_INFO_MS = 2 * YEAR_MS
const ABANDONED_WARN_MS = 3 * YEAR_MS

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

/**
 * Classify a declared version range so "outdated" reflects what `npm install`
 * would actually leave behind — not just the floor:
 *  - `caret`  (`^1.2.3`) auto-accepts minor+patch within the major → only a NEW
 *    major counts as behind.
 *  - `tilde`  (`~1.2.3`) accepts patch only → a new minor (or major) is behind.
 *  - `exact`  (`1.2.3` / `=1.2.3`) is pinned → any newer minor/major is behind.
 *  - `other`  (`>=`, `*`, `1.x`, `||`, `npm:`, `workspace:` …) can't be compared
 *    meaningfully → skip the outdated check to avoid false positives.
 */
type RangeKind = "caret" | "tilde" | "exact" | "other"
function rangeKind(decl: string): RangeKind {
  const s = (decl ?? "").trim()
  if (s.startsWith("^")) return "caret"
  if (s.startsWith("~")) return "tilde"
  if (/^=?\s*v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(s)) return "exact"
  return "other"
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

/**
 * Packages consumed by a framework/runtime without an explicit source import, so
 * a reference graph can't see them. Flagging these as "unused" is a false
 * positive (e.g. Next.js renders with react-dom though app code never imports it).
 */
const FRAMEWORK_IMPLICIT = new Set(["react-dom"])

/** Config files whose contents reference deps by name (often without an import). */
const CONFIG_FILE_RE =
  /(^|\/)(next|postcss|tailwind|vite|vitest|rollup|webpack|babel|jest|eslint|prettier|stylelint|playwright|cypress|tsup|drizzle|svelte|astro|nuxt)\.config\.[cm]?[jt]s$|(^|\/)\.(babelrc|eslintrc|prettierrc|stylelintrc)[\w.]*$/i

/**
 * Build a text blob of "tooling usage": npm-script bodies + the contents of build
 * config files. A dep referenced only here (a CLI in scripts, a postcss plugin
 * keyed by string, an eslint plugin) is genuinely used even with no source import.
 */
async function collectToolingText(ctx: ScanContext, scripts: Record<string, string>): Promise<string> {
  let text = Object.values(scripts ?? {}).join("\n")
  for (const file of ctx.files) {
    if (!CONFIG_FILE_RE.test(file)) continue
    const content = await ctx.readFile(file)
    if (content) text += `\n${content}`
  }
  return text
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

    let pkgJson: { dependencies?: Record<string, string>; scripts?: Record<string, string> }
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
    const toolingText = await collectToolingText(ctx, pkgJson.scripts ?? {})

    // A dep counts as used if imported in source, consumed by a framework runtime,
    // or referenced by a build script / config file (CLIs, plugins keyed by name).
    const isUsed = (name: string): boolean =>
      used.has(name) || FRAMEWORK_IMPLICIT.has(name) || toolingText.includes(name)

    for (const name of names) {
      // 1) unused (static, works offline) — @types/* are never imported directly
      if (!isUsed(name) && !name.startsWith("@types/")) {
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
      } else if (info.lastPublishMs && Date.now() - info.lastPublishMs > ABANDONED_INFO_MS) {
        const gap = Date.now() - info.lastPublishMs
        const years = Math.floor(gap / YEAR_MS)
        // 3+ years → likely unmaintained (warning); 2-3 years → soft note (info),
        // since a stable micro-lib may just be feature-complete.
        const severity: Severity = gap > ABANDONED_WARN_MS ? "warning" : "info"
        issues.push({
          id: `dep-abandoned-${name}`,
          category: "dependency",
          severity,
          title: `${name} looks abandoned (no release in ${years}+ years)`,
          location: "package.json",
          ageDays: 0,
          detail:
            severity === "warning"
              ? `${name} has not published a new version in over ${years} years. It may be unmaintained.`
              : `${name} has not published a new version in ${years}+ years. It may simply be ` +
                `feature-complete — confirm it's still maintained if you depend on it heavily.`,
        })
      }

      // 3) outdated: compare declared range to latest, honoring the range operator
      // so a caret/tilde that already auto-upgrades isn't reported as "behind".
      const current = parseSemver(deps[name])
      const latest = parseSemver(info.latest)
      const kindOf = rangeKind(deps[name])
      if (current && latest && kindOf !== "other") {
        let severity: Severity | null = null
        let kind = ""
        if (latest.major > current.major) {
          // No range short of a major-allowing one crosses a major boundary.
          severity = "warning"
          kind = "major"
        } else if (
          latest.major === current.major &&
          latest.minor > current.minor &&
          kindOf !== "caret" // caret already pulls newer minors on install
        ) {
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
