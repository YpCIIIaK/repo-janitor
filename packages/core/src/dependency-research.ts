import type { ScanContext } from "./scanner"
import { parseYarnDependencyResearch } from "./yarn-dependency-research"

export type DependencyRuntime = "production" | "development" | "both" | "unknown"
export type DependencyNodeKind = "project" | "package"
export type DependencyEdgeKind = "dependency" | "optional" | "development" | "workspace"

export interface DependencyResearchNode {
  id: string
  kind: DependencyNodeKind
  name: string
  version: string | null
  runtime: DependencyRuntime
  location: string
  importer?: string
}

export interface DependencyResearchEdge {
  from: string
  to: string
  name: string
  requested: string
  kind: DependencyEdgeKind
  scope: "production" | "development"
}

export interface DependencyResearchPath {
  runtime: Exclude<DependencyRuntime, "unknown">
  nodeIds: string[]
}

export interface DependencyResearchOptions {
  /** Package name or `name@version`. Paths are returned only for matching nodes. */
  target?: string
  /** Protect reports from pathological graphs. Defaults to 100 paths per target. */
  maxPaths?: number
  /** Hard parser budgets. Defaults match the public deep-analysis endpoint. */
  maxNodes?: number
  maxEdges?: number
}

export interface DependencyResearchResult {
  manager: "npm" | "pnpm" | "yarn"
  lockfile: string
  nodes: DependencyResearchNode[]
  edges: DependencyResearchEdge[]
  matches: string[]
  paths: DependencyResearchPath[]
  warnings: string[]
}

export interface DependencyResearchMutableNode extends DependencyResearchNode {
  prod: boolean
  dev: boolean
}

export class DependencyResearchLimitError extends Error {
  constructor(public readonly kind: "nodes" | "edges") {
    super(`Dependency graph exceeds the ${kind} limit.`)
    this.name = "DependencyResearchLimitError"
  }
}

export function assertDependencyResearchBudget(
  options: DependencyResearchOptions, kind: "nodes" | "edges", count: number,
): void {
  const limit = kind === "nodes" ? options.maxNodes ?? 5_000 : options.maxEdges ?? 15_000
  if (count > limit) throw new DependencyResearchLimitError(kind)
}

const clean = (value: string) => value.trim().replace(/^['"]|['"]$/g, "").replace(/,$/, "")
const depKind = (group: string): DependencyEdgeKind =>
  group === "devDependencies" ? "development" : group === "optionalDependencies" ? "optional" : "dependency"

function targetMatches(node: DependencyResearchNode, target?: string): boolean {
  if (!target || node.kind !== "package") return !target || node.kind === "package"
  if (target === node.name) return true
  return node.version !== null && target === `${node.name}@${node.version}`
}

export function finalizeDependencyResearch(
  manager: DependencyResearchResult["manager"], lockfile: string,
  nodeMap: Map<string, DependencyResearchMutableNode>, edges: DependencyResearchEdge[], options: DependencyResearchOptions,
  warnings: string[] = [],
): DependencyResearchResult {
  const outgoing = new Map<string, DependencyResearchEdge[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.from)
    if (list) list.push(edge)
    else outgoing.set(edge.from, [edge])
  }
  const roots = [...nodeMap.values()].filter((node) => node.kind === "project")

  const mark = (mode: "prod" | "dev", start: string, permitted: (edge: DependencyResearchEdge) => boolean) => {
    const queue = [start]
    const seen = new Set<string>()
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]
      if (seen.has(id)) continue
      seen.add(id)
      const node = nodeMap.get(id)
      if (node) node[mode] = true
      for (const edge of outgoing.get(id) ?? []) if (permitted(edge)) queue.push(edge.to)
    }
  }
  for (const root of roots) {
    mark("prod", root.id, (edge) => edge.scope !== "development")
    // A development path starts with a dev root edge and then follows normal runtime edges.
    for (const edge of outgoing.get(root.id) ?? []) if (edge.scope === "development") {
      mark("dev", edge.to, (child) => child.scope !== "development")
    }
  }
  for (const node of nodeMap.values()) {
    node.runtime = node.prod && node.dev ? "both" : node.prod ? "production" : node.dev ? "development" : "unknown"
  }

  const matches = [...nodeMap.values()].filter((node) => targetMatches(node, options.target)).map((node) => node.id)
  const wanted = new Set(matches)
  const incoming = new Map<string, string[]>()
  for (const edge of edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
  const relevant = new Set(matches)
  const reverseQueue = [...matches]
  for (let cursor = 0; cursor < reverseQueue.length; cursor++) {
    for (const parent of incoming.get(reverseQueue[cursor]) ?? []) if (!relevant.has(parent)) {
      relevant.add(parent)
      reverseQueue.push(parent)
    }
  }
  const paths: DependencyResearchPath[] = []
  const maxPaths = Math.max(1, options.maxPaths ?? 100)
  let truncated = false
  const walk = (start: string, mode: "production" | "development") => {
    const stack = [{ id: start, path: [] as string[], devStarted: false }]
    let walkSteps = 0
    while (stack.length && paths.length < maxPaths && walkSteps < 20_000) {
      const state = stack.pop()!
      walkSteps++
      if (state.path.length >= 128 || state.path.includes(state.id)) { truncated = true; continue }
      const next = [...state.path, state.id]
      if (wanted.has(state.id)) { paths.push({ runtime: mode, nodeIds: next }); continue }
      for (const edge of outgoing.get(state.id) ?? []) {
        if (!relevant.has(edge.to)) continue
        if (mode === "production" && edge.scope === "development") continue
        if (mode === "development" && !state.devStarted && edge.scope !== "development") continue
        if (mode === "development" && state.devStarted && edge.scope === "development") continue
        stack.push({ id: edge.to, path: next, devStarted: state.devStarted || edge.scope === "development" })
      }
    }
    if (stack.length && (walkSteps >= 20_000 || paths.length >= maxPaths)) truncated = true
  }
  if (options.target) for (const root of roots) {
    walk(root.id, "production")
    walk(root.id, "development")
  }
  if (truncated) warnings.push("Dependency path search reached its safety limit; the path list may be incomplete.")

  const nodes = [...nodeMap.values()].map(({ prod: _prod, dev: _dev, ...node }) => node)
  return { manager, lockfile, nodes, edges, matches, paths, warnings }
}

function packageNameFromPath(path: string, fallback?: string): string | null {
  if (fallback) return fallback
  const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)
  return match?.[1] ?? null
}

function parseNpm(text: string, lockfile: string, options: DependencyResearchOptions): DependencyResearchResult | null {
  const json = JSON.parse(text) as { lockfileVersion?: number; packages?: Record<string, Record<string, unknown>> }
  if (!json.packages || (json.lockfileVersion !== 2 && json.lockfileVersion !== 3)) return null
  const nodes = new Map<string, DependencyResearchMutableNode>()
  const pathToId = new Map<string, string>()
  for (const [location, raw] of Object.entries(json.packages)) {
    const name = packageNameFromPath(location, typeof raw.name === "string" ? raw.name : undefined)
    const isProject = location === "" || !location.includes("node_modules")
    if (!name && !isProject) continue
    const id = `npm:${location || "."}`
    const version = typeof raw.version === "string" ? raw.version : null
    nodes.set(id, { id, kind: isProject ? "project" : "package", name: name ?? "root", version,
      runtime: "unknown", location: location || ".", importer: isProject ? location || "." : undefined, prod: false, dev: false })
    assertDependencyResearchBudget(options, "nodes", nodes.size)
    pathToId.set(location, id)
  }
  // npm represents workspace links as node_modules entries pointing at another
  // package entry. Resolve those aliases to the project node itself.
  for (const [location, raw] of Object.entries(json.packages)) {
    if (raw.link === true && typeof raw.resolved === "string") {
      const target = pathToId.get(String(raw.resolved).replace(/^\.\//, ""))
      if (target) pathToId.set(location, target)
    }
  }
  const resolve = (from: string, name: string): string | null => {
    let base = from
    while (true) {
      const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
      if (pathToId.has(candidate)) return pathToId.get(candidate)!
      const marker = base.lastIndexOf("/node_modules/")
      if (marker < 0) break
      base = base.slice(0, marker)
    }
    return pathToId.get(`node_modules/${name}`) ?? null
  }
  const edges: DependencyResearchEdge[] = []
  const warnings: string[] = []
  for (const [location, raw] of Object.entries(json.packages)) {
    const from = pathToId.get(location)
    if (!from) continue
    for (const group of ["dependencies", "optionalDependencies", "devDependencies"] as const) {
      const deps = raw[group]
      if (!deps || typeof deps !== "object") continue
      for (const [name, requested] of Object.entries(deps as Record<string, unknown>)) {
        const to = resolve(location, name)
        if (to) edges.push({ from, to, name, requested: String(requested),
          kind: nodes.get(to)?.kind === "project" ? "workspace" : depKind(group),
          scope: group === "devDependencies" ? "development" : "production" })
        else warnings.push(`Could not resolve ${name} from ${location || "."}`)
      }
      assertDependencyResearchBudget(options, "edges", edges.length)
    }
  }
  return finalizeDependencyResearch("npm", lockfile, nodes, edges, options, warnings)
}

interface PnpmRef { name: string; requested: string; group: string }
interface PnpmEntry { id: string; name: string; version: string; refs: PnpmRef[] }

function pnpmIdentity(value: string): { id: string; name: string; version: string } | null {
  const id = clean(value.replace(/:\s*(?:\{\})?$/, "")).replace(/^\//, "")
  const plain = id.replace(/\(.*$/, "")
  const at = plain.lastIndexOf("@")
  if (at <= 0 || !/^\d+\.\d+\.\d+/.test(plain.slice(at + 1))) return null
  return { id, name: plain.slice(0, at), version: plain.slice(at + 1) }
}

function parsePnpm(text: string, lockfile: string, options: DependencyResearchOptions, manifests: Map<string, string>): DependencyResearchResult | null {
  if (!/^lockfileVersion:\s*['"]?9(?:\.0)?['"]?\s*$/m.test(text)) return null
  let section: "importers" | "snapshots" | null = null
  let importer = "."
  let snapshot: PnpmEntry | null = null
  let group = ""
  let pending: string | null = null
  const importers = new Map<string, PnpmRef[]>()
  const snapshots = new Map<string, PnpmEntry>()
  const add = (name: string, requested: string) => {
    const ref = { name, requested: clean(requested), group }
    if (section === "importers") importers.get(importer)!.push(ref)
    else snapshot?.refs.push(ref)
  }
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (indent === 0) { section = line === "importers:" ? "importers" : line === "snapshots:" ? "snapshots" : null; group = ""; continue }
    if (!section) continue
    if (indent === 2) {
      group = ""; pending = null
      if (section === "importers") { importer = clean(line.replace(/:\s*(?:\{\})?$/, "")); importers.set(importer, []) }
      else { const identity = pnpmIdentity(line); snapshot = identity ? { ...identity, refs: [] } : null; if (snapshot) snapshots.set(snapshot.id, snapshot) }
      continue
    }
    if (indent === 4) { group = line.match(/^([A-Za-z]+):/)?.[1] ?? ""; pending = null; continue }
    if (!["dependencies", "optionalDependencies", "devDependencies"].includes(group)) continue
    if (indent === 6) {
      const match = line.match(/^(?:'([^']+)'|"([^"]+)"|([^:]+)):\s*(.*)$/)
      if (!match) continue
      const name = match[1] ?? match[2] ?? match[3].trim()
      pending = match[4] ? null : name
      if (match[4]) add(name, match[4])
    } else if (indent >= 8 && pending) {
      const match = line.match(/^version:\s*(.+)$/)
      if (match) add(pending, match[1])
    }
  }
  if (!importers.size || !snapshots.size) return null

  const nodes = new Map<string, DependencyResearchMutableNode>()
  for (const path of importers.keys()) {
    let name = path === "." ? "root" : path
    try { name = JSON.parse(manifests.get(path) ?? "{}").name ?? name } catch { /* retain path */ }
    nodes.set(`pnpm:importer:${path}`, { id: `pnpm:importer:${path}`, kind: "project", name, version: null,
      runtime: "unknown", location: path, importer: path, prod: false, dev: false })
    assertDependencyResearchBudget(options, "nodes", nodes.size)
  }
  for (const entry of snapshots.values()) {
    nodes.set(`pnpm:${entry.id}`, { id: `pnpm:${entry.id}`, kind: "package", name: entry.name,
      version: entry.version, runtime: "unknown", location: entry.id, prod: false, dev: false })
    assertDependencyResearchBudget(options, "nodes", nodes.size)
  }

  const normalizeLink = (base: string, relative: string): string => {
    const parts = `${base === "." ? "" : base}/${relative}`.split("/")
    const out: string[] = []
    for (const part of parts) {
      if (!part || part === ".") continue
      if (part === "..") out.pop()
      else out.push(part)
    }
    return out.join("/") || "."
  }
  const resolve = (name: string, rawRef: string, fromImporter = "."): string | null => {
    let ref = clean(rawRef).replace(/^\//, "")
    if (/^(?:link|workspace):/.test(ref)) {
      const wantedName = ref.startsWith("workspace:") && ref.includes("/") ? ref.replace(/^workspace:/, "").replace(/^\.\//, "") : null
      const rawPath = ref.replace(/^(?:link|workspace):/, "")
      const linkedPath = normalizeLink(fromImporter, rawPath)
      for (const [path, json] of manifests) {
        try { if (path === linkedPath || (wantedName && path === wantedName) || JSON.parse(json).name === name) return `pnpm:importer:${path}` } catch { /* skip */ }
      }
      return null
    }
    let actual = name
    if (ref.startsWith("npm:")) ref = ref.slice(4)
    const noPeer = ref.replace(/\(.*$/, "")
    const aliasAt = noPeer.lastIndexOf("@")
    if (aliasAt > 0 && /^\d+\.\d+\.\d+/.test(noPeer.slice(aliasAt + 1))) { actual = noPeer.slice(0, aliasAt); ref = ref.slice(aliasAt + 1) }
    const exact = snapshots.get(`${actual}@${ref}`)
    if (exact) return `pnpm:${exact.id}`
    const version = ref.match(/^\d+\.\d+\.\d+[^()]*/)?.[0]
    const candidates = [...snapshots.values()].filter((item) => item.name === actual && item.version === version)
    return candidates.length === 1 ? `pnpm:${candidates[0].id}` : null
  }
  const edges: DependencyResearchEdge[] = []
  const warnings: string[] = []
  for (const [path, refs] of importers) for (const ref of refs) {
    const to = resolve(ref.name, ref.requested, path)
    if (to) edges.push({ from: `pnpm:importer:${path}`, to, name: ref.name, requested: ref.requested,
      kind: to.startsWith("pnpm:importer:") ? "workspace" : depKind(ref.group),
      scope: ref.group === "devDependencies" ? "development" : "production" })
    else warnings.push(`Could not resolve ${ref.name} from importer ${path}`)
    assertDependencyResearchBudget(options, "edges", edges.length)
  }
  for (const entry of snapshots.values()) for (const ref of entry.refs) {
    const to = resolve(ref.name, ref.requested)
    if (to) edges.push({ from: `pnpm:${entry.id}`, to, name: ref.name, requested: ref.requested, kind: depKind(ref.group),
      scope: ref.group === "devDependencies" ? "development" : "production" })
    else warnings.push(`Could not resolve ${ref.name} from ${entry.id}`)
    assertDependencyResearchBudget(options, "edges", edges.length)
  }
  return finalizeDependencyResearch("pnpm", lockfile, nodes, edges, options, warnings)
}

/** Build an explainable dependency graph from a committed npm, pnpm or Yarn lockfile. */
export async function researchDependencyGraph(
  ctx: ScanContext,
  fileSet: Set<string> = new Set(ctx.files),
  options: DependencyResearchOptions = {},
): Promise<DependencyResearchResult | null> {
  for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (!fileSet.has(lockfile)) continue
    const text = await ctx.readFile(lockfile)
    if (!text) continue
    try { const result = parseNpm(text, lockfile, options); if (result) return result } catch (error) {
      if (error instanceof DependencyResearchLimitError) throw error
      /* malformed npm lockfile — try another supported manager */
    }
  }
  if (fileSet.has("pnpm-lock.yaml")) {
    const text = await ctx.readFile("pnpm-lock.yaml")
    if (text) {
      const manifests = new Map<string, string>()
      for (const file of fileSet) if (file === "package.json" || file.endsWith("/package.json")) {
        const body = await ctx.readFile(file)
        if (body) manifests.set(file === "package.json" ? "." : file.slice(0, -13), body)
      }
      return parsePnpm(text, "pnpm-lock.yaml", options, manifests)
    }
  }
  if (fileSet.has("yarn.lock")) {
    const text = await ctx.readFile("yarn.lock")
    if (text) {
      const manifests = new Map<string, string>()
      for (const file of fileSet) if (file === "package.json" || file.endsWith("/package.json")) {
        const body = await ctx.readFile(file)
        if (body) manifests.set(file === "package.json" ? "." : file.slice(0, -13), body)
      }
      return parseYarnDependencyResearch(text, manifests, options)
    }
  }
  return null
}
