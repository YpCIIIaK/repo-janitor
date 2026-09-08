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

export interface NpmPackageInstance {
  name: string
  version: string
  runtime: boolean
  direct: boolean
  manifest: string
  paths: string[]
}

const instanceKey = (name: string, version: string) => `${name}\0${version}`

/**
 * Exact installed npm package instances. Unlike computeNpmProdSet, this keeps
 * two versions of the same package separate so a dev-only copy cannot lend its
 * reachability (or hide its advisory) to a production copy.
 */
export async function computeNpmPackageInstances(
  ctx: ScanContext,
  fileSet: Set<string>,
): Promise<NpmPackageInstance[] | null> {
  for (const lf of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fileSet.has(lf)) continue
    const txt = await ctx.readFile(lf)
    if (!txt) continue
    try {
      const json = JSON.parse(txt) as {
        packages?: Record<string, { name?: string; version?: string; dev?: boolean; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>
        dependencies?: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }>
      }
      const found = new Map<string, NpmPackageInstance>()
      const add = (name: string, version: string, runtime: boolean, direct: boolean, path: string) => {
        const key = instanceKey(name, version)
        const old = found.get(key)
        if (!old) found.set(key, { name, version, runtime, direct, manifest: "package.json", paths: [path] })
        else found.set(key, {
          ...old,
          runtime: old.runtime || runtime,
          direct: old.direct || direct,
          paths: old.paths.includes(path) ? old.paths : [...old.paths, path],
        })
      }
      for (const [path, value] of Object.entries(json.packages ?? {})) {
        const m = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
        if (m && typeof value.version === "string") {
          const nodeModulesCount = (path.match(/(?:^|\/)node_modules\//g) ?? []).length
          const installedName = m[1]
          const actualName = value.name || installedName
          add(actualName, value.version, value.dev !== true, nodeModulesCount === 1, path)
        }
      }
      const walk = (deps: Record<string, { version?: string; dev?: boolean; dependencies?: unknown }> | undefined) => {
        for (const [name, value] of Object.entries(deps ?? {})) {
          if (typeof value.version === "string") add(name, value.version, value.dev !== true, false, name)
          walk(value.dependencies as typeof deps)
        }
      }
      walk(json.dependencies)
      if (found.size) return [...found.values()]
    } catch {
      // Try another supported lockfile.
    }
  }

  if (fileSet.has("pnpm-lock.yaml")) {
    const txt = await ctx.readFile("pnpm-lock.yaml")
    if (txt) return parsePnpmPackageInstances(txt)
  }

  return null
}

interface PnpmNode {
  id: string
  name: string
  version: string
  refs: { name: string; ref: string }[]
  importer?: string
  path?: string[]
}

function pnpmIdentity(raw: string): Pick<PnpmNode, "id" | "name" | "version"> | null {
  const id = unquote(raw.trim().replace(/:\s*(?:\{\})?$/, "")).replace(/^\//, "")
  const withoutPeer = id.replace(/\(.*$/, "")
  const at = withoutPeer.lastIndexOf("@")
  if (at <= 0) return null
  const name = withoutPeer.slice(0, at)
  const version = withoutPeer.slice(at + 1)
  if (!/^\d+\.\d+\.\d+/.test(version)) return null
  return { id, name, version }
}

function parsePnpmPackageInstances(txt: string): NpmPackageInstance[] | null {
  const nodes = new Map<string, PnpmNode>()
  const seedRefs: { name: string; ref: string; importer: string; runtime: boolean }[] = []
  let section: "importers" | "snapshots" | null = null
  let current: PnpmNode | null = null
  let group: string | null = null
  let pending: string | null = null
  let sawImporter = false
  let importer = "."

  const addRef = (name: string, ref: string) => {
    const clean = unquote(ref.trim()).replace(/,$/, "")
    if (!clean) return
    if (section === "importers") seedRefs.push({ name, ref: clean, importer, runtime: PROD_GROUPS.has(group ?? "") })
    else if (current) current.refs.push({ name, ref: clean })
  }

  for (const rawLine of txt.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue
    const indent = rawLine.length - rawLine.trimStart().length
    const line = rawLine.trim()
    if (indent === 0) {
      section = line === "importers:" ? "importers" : line === "snapshots:" ? "snapshots" : null
      current = null
      group = null
      pending = null
      continue
    }
    if (!section) continue
    if (indent === 2) {
      group = null
      pending = null
      if (section === "importers") {
        sawImporter = true
        importer = unquote(line.replace(/:\s*(?:\{\})?$/, ""))
        current = null
      } else {
        const identity = pnpmIdentity(line)
        current = identity ? { ...identity, refs: [] } : null
        if (current) nodes.set(current.id, current)
      }
      continue
    }
    if (indent === 4) {
      group = line.match(/^([A-Za-z]+):/)?.[1] ?? null
      pending = null
      continue
    }
    if (!group || (section === "snapshots" && !PROD_GROUPS.has(group))) continue
    if (section === "importers" && !PROD_GROUPS.has(group) && group !== "devDependencies") continue
    if (indent === 6) {
      const m = line.match(/^(?:'([^']+)'|"([^"]+)"|([^:]+)):\s*(.*)$/)
      if (!m) continue
      const name = m[1] ?? m[2] ?? m[3].trim()
      const ref = m[4].trim()
      pending = ref ? null : name
      if (ref && name !== "specifier" && name !== "version") addRef(name, ref)
      continue
    }
    if (indent >= 8 && pending) {
      const m = line.match(/^version:\s*(.+)$/)
      if (m) addRef(pending, m[1])
    }
  }

  if (!sawImporter || nodes.size === 0) return null

  const resolve = ({ name, ref }: { name: string; ref: string }): PnpmNode[] => {
    let actualName = name
    let wanted = ref.replace(/^\//, "")
    if (wanted.startsWith("npm:")) {
      const alias = wanted.slice(4).replace(/\(.*$/, "")
      const at = alias.lastIndexOf("@")
      if (at > 0) {
        actualName = alias.slice(0, at)
        wanted = alias.slice(at + 1)
      }
    }
    // pnpm v9 aliases commonly store `version: real-name@1.2.3` while the
    // dependency key remains the local alias.
    const aliased = wanted.replace(/\(.*$/, "")
    const aliasAt = aliased.lastIndexOf("@")
    if (aliasAt > 0 && /^\d+\.\d+\.\d+/.test(aliased.slice(aliasAt + 1))) {
      actualName = aliased.slice(0, aliasAt)
      wanted = aliased.slice(aliasAt + 1)
    }
    if (/^(?:link|workspace|file|https?):/.test(wanted)) return []
    const exact = nodes.get(`${actualName}@${wanted}`)
    if (exact) return [exact]
    const version = wanted.match(/\d+\.\d+\.\d+[^\s()]*/)?.[0]
    if (!version) return []
    return [...nodes.values()].filter((node) => node.name === actualName && node.version === version)
  }

  for (const seed of seedRefs) {
    for (const node of resolve(seed)) {
      node.importer ??= seed.importer
      node.path ??= [seed.importer, node.id]
    }
  }
  const directIds = new Set(seedRefs.flatMap((ref) => resolve(ref).map((node) => node.id)))
  const runtimeIds = new Set<string>()
  const queue = seedRefs.filter((seed) => seed.runtime).flatMap((seed) => resolve(seed).map((node) => node.id))
  while (queue.length) {
    const id = queue.pop()!
    if (runtimeIds.has(id)) continue
    runtimeIds.add(id)
    for (const ref of nodes.get(id)?.refs ?? []) {
      for (const target of resolve(ref)) {
        const parent = nodes.get(id)
        if (!target.path && parent?.path) target.path = [...parent.path, target.id]
        target.importer ??= parent?.importer
        if (!runtimeIds.has(target.id)) queue.push(target.id)
      }
    }
  }

  return [...nodes.values()].map((node) => ({
    name: node.name,
    version: node.version,
    runtime: runtimeIds.has(node.id),
    direct: directIds.has(node.id),
    manifest: node.importer && node.importer !== "." ? `${node.importer}/package.json` : "package.json",
    paths: node.path ?? [node.id],
  }))
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
  let sawImporter = false

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
      if (section === "importers" && /:\s*(?:\{\})?$/.test(line)) sawImporter = true
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

  // A valid importer with only devDependencies has a known, empty production
  // graph. Treating it as unknown incorrectly elevates all transitive tooling.
  if (!sawImporters || !sawImporter) return null
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
