import type { ScanContext } from "./scanner"

/**
 * Lockfile dependency graph → "does this package reach production?".
 *
 * Severity for a vulnerability depends on whether the affected code can actually
 * run in the deployed artefact. A DoS in `brace-expansion` reached only through
 * `eslint` is not a production risk; the same advisory under `next` is.
 *
 * We do NOT trust the `dev` flag reported by audit tooling: in a pnpm workspace
 * `pnpm audit` marks every advisory `dev: false` and reports `devDependencies: 0`,
 * so build-only packages look like runtime ones. Instead we walk the lockfile
 * graph ourselves: seed from each importer's production dependencies and follow
 * edges transitively.
 *
 * Returns `null` when the graph cannot be determined (no recognised lockfile,
 * unparseable, or no importers). Callers must treat `null` as "unknown" and skip
 * the dev-path downgrade rather than guessing — the safe direction is to keep the
 * severity the advisory claims.
 */

/** Groups whose members are installed in a production install. */
const PROD_GROUPS = new Set(["dependencies", "optionalDependencies"])

/** Strip surrounding quotes from a YAML scalar/key. */
function unquote(s: string): string {
  return s.replace(/^['"]|['"]$/g, "")
}

/**
 * `'@babel/core@7.29.7(react@19)'` → `@babel/core`.
 * Handles scoped names and pnpm's peer-suffix parenthetical.
 */
function snapshotKeyToName(key: string): string | null {
  let k = unquote(key.trim()).replace(/:$/, "")
  k = k.replace(/\(.*$/, "") // drop peer-dependency suffix
  if (k.startsWith("/")) k = k.slice(1) // pnpm v6 leading slash
  const at = k.lastIndexOf("@")
  if (at <= 0) return null
  return k.slice(0, at) || null
}

interface LockGraph {
  /** direct production dependencies of every workspace importer */
  seeds: Set<string>
  /** package name → names of its production dependencies */
  edges: Map<string, Set<string>>
}

/**
 * Minimal indentation-driven reader for the two pnpm-lock sections we need.
 *
 * A full YAML parser would be a dependency for no gain: the shape here is fixed
 * and machine-generated, always two-space indented, and we only ever read keys.
 */
function parsePnpmLock(txt: string): LockGraph | null {
  const seeds = new Set<string>()
  const edges = new Map<string, Set<string>>()

  let section: "importers" | "graph" | null = null
  let current: string | null = null // snapshot package name
  let group: string | null = null // dependencies / devDependencies / ...
  let sawImporters = false

  for (const rawLine of txt.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue

    const indent = rawLine.length - rawLine.trimStart().length
    const line = rawLine.trim()

    // Top-level section header.
    if (indent === 0) {
      if (line === "importers:") {
        section = "importers"
        sawImporters = true
      } else if (line === "snapshots:" || line === "packages:") {
        section = "graph"
      } else {
        section = null
      }
      current = null
      group = null
      continue
    }
    if (!section) continue

    if (indent === 2) {
      // importer path, or snapshot/package key
      current = section === "importers" ? unquote(line.replace(/:$/, "")) : snapshotKeyToName(line)
      group = null
      continue
    }

    if (indent === 4) {
      const m = line.match(/^([A-Za-z]+):/)
      group = m ? m[1] : null
      continue
    }

    if (indent >= 6 && group && PROD_GROUPS.has(group)) {
      // `name: version`, or `'name':` opening a specifier/version block.
      const m = line.match(/^('[^']+'|"[^"]+"|[^:]+):/)
      if (!m) continue
      const name = unquote(m[1].trim())
      if (!name || name === "specifier" || name === "version") continue

      if (section === "importers") {
        seeds.add(name)
      } else if (current) {
        let set = edges.get(current)
        if (!set) edges.set(current, (set = new Set()))
        set.add(name)
      }
    }
  }

  // Without importers we have no production root to walk from — refuse to guess.
  if (!sawImporters || seeds.size === 0) return null
  return { seeds, edges }
}

/** BFS the graph from the production roots. */
function reachable(graph: LockGraph): Set<string> {
  const seen = new Set<string>()
  const queue = [...graph.seeds]
  while (queue.length) {
    const name = queue.pop()!
    if (seen.has(name)) continue
    seen.add(name)
    for (const next of graph.edges.get(name) ?? []) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  return seen
}

/** npm's own `dev` flag is trustworthy — read the prod set straight off it. */
function parseNpmLock(txt: string): Set<string> | null {
  try {
    const json = JSON.parse(txt) as {
      packages?: Record<string, { version?: string; dev?: boolean }>
      dependencies?: Record<string, { dev?: boolean; dependencies?: unknown }>
    }
    const prod = new Set<string>()
    let saw = false

    for (const [key, val] of Object.entries(json.packages ?? {})) {
      const m = key.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
      if (!m) continue
      saw = true
      if (val?.dev !== true) prod.add(m[1])
    }

    const walk = (deps: Record<string, { dev?: boolean; dependencies?: unknown }> | undefined) => {
      for (const [name, val] of Object.entries(deps ?? {})) {
        saw = true
        if (val?.dev !== true) prod.add(name)
        walk(val?.dependencies as typeof deps)
      }
    }
    walk(json.dependencies)

    return saw ? prod : null
  } catch {
    return null
  }
}

/**
 * Names of every npm package that a production install would put on disk.
 * `null` means "could not determine" — see the module note.
 */
export async function computeNpmProdSet(
  ctx: ScanContext,
  fileSet: Set<string>,
): Promise<Set<string> | null> {
  for (const lf of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fileSet.has(lf)) continue
    const txt = await ctx.readFile(lf)
    const prod = txt ? parseNpmLock(txt) : null
    if (prod) return prod
  }

  if (fileSet.has("pnpm-lock.yaml")) {
    const txt = await ctx.readFile("pnpm-lock.yaml")
    const graph = txt ? parsePnpmLock(txt) : null
    if (graph) return reachable(graph)
  }

  // yarn.lock records no dev/prod split at all — nothing to compute.
  return null
}
