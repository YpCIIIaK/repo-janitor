import { parseSyml } from "@yarnpkg/parsers"
import {
  assertDependencyResearchBudget,
  finalizeDependencyResearch,
  type DependencyResearchEdge,
  type DependencyResearchMutableNode,
  type DependencyResearchOptions,
  type DependencyResearchResult,
} from "./dependency-research"

type ManifestInput = Map<string, string> | Record<string, string>
type LockValue = string | Record<string, unknown> | undefined

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null

function splitDescriptors(key: string): string[] {
  const descriptors: string[] = []
  let quote = ""
  let start = 0
  for (let index = 0; index < key.length; index++) {
    const char = key[index]
    if ((char === "\"" || char === "'") && (!quote || quote === char)) quote = quote ? "" : char
    else if (char === "," && !quote) { descriptors.push(key.slice(start, index).trim()); start = index + 1 }
  }
  descriptors.push(key.slice(start).trim())
  return descriptors.map((value) => value.replace(/^["']|["']$/g, "")).filter(Boolean)
}

function descriptorName(descriptor: string): string | null {
  const at = descriptor.startsWith("@") ? descriptor.indexOf("@", 1) : descriptor.indexOf("@")
  return at > 0 ? descriptor.slice(0, at) : null
}

function aliasTarget(descriptor: string): string | null {
  const marker = descriptor.indexOf("@npm:")
  return marker > 0 ? descriptorName(descriptor.slice(marker + 5)) : null
}

function descriptorCandidates(name: string, requested: string): string[] {
  const result = [`${name}@${requested}`]
  if (!/^[a-z][a-z+.-]*:/i.test(requested)) result.push(`${name}@npm:${requested}`)
  return result
}

function dependencyEntries(value: LockValue): Array<[string, string]> {
  const record = asRecord(value)
  return record ? Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string") : []
}

/** Parse Yarn Classic or Berry without executing Yarn or repository code. */
export function parseYarnDependencyResearch(
  text: string,
  manifests: ManifestInput,
  options: DependencyResearchOptions = {},
): DependencyResearchResult | null {
  let parsed: Record<string, unknown>
  try { parsed = parseSyml(text) as Record<string, unknown> } catch { return null }
  const lockEntries = Object.entries(parsed).filter(([key, value]) => key !== "__metadata" && asRecord(value))
  if (!lockEntries.length) return null

  const warnings: string[] = []
  const manifestMap = manifests instanceof Map ? manifests : new Map(Object.entries(manifests))
  const manifestRecords = new Map<string, Record<string, unknown>>()
  const workspaceByName = new Map<string, string>()
  const nodes = new Map<string, DependencyResearchMutableNode>()
  for (const [path, source] of manifestMap) {
    try {
      const manifest = JSON.parse(source) as Record<string, unknown>
      manifestRecords.set(path, manifest)
      const name = typeof manifest.name === "string" ? manifest.name : path === "." ? "root" : path
      if (typeof manifest.name === "string") workspaceByName.set(manifest.name, path)
      const id = `yarn:project:${path}`
      nodes.set(id, { id, kind: "project", name, version: typeof manifest.version === "string" ? manifest.version : null,
        runtime: "unknown", location: path, importer: path, prod: false, dev: false })
      assertDependencyResearchBudget(options, "nodes", nodes.size)
    } catch { warnings.push(`Could not parse manifest for Yarn importer ${path}.`) }
  }
  if (!nodes.size) {
    const id = "yarn:project:."
    nodes.set(id, { id, kind: "project", name: "root", version: null, runtime: "unknown", location: ".", importer: ".",
      prod: false, dev: false })
    warnings.push("No valid package.json manifest was available; Yarn runtime reachability is unknown.")
  }

  const descriptorToIds = new Map<string, Set<string>>()
  const externalEntries = new Map<string, Record<string, unknown>>()
  let hasPeerContracts = false
  const mapDescriptor = (descriptor: string, id: string) => {
    const ids = descriptorToIds.get(descriptor) ?? new Set<string>()
    ids.add(id)
    descriptorToIds.set(descriptor, ids)
  }
  for (const [key, rawValue] of lockEntries) {
    const value = asRecord(rawValue)!
    const descriptors = splitDescriptors(key)
    const resolution = typeof value.resolution === "string" ? value.resolution : ""
    const workspaceMatch = resolution.match(/^(.+)@workspace:(.+)$/)
    if (workspaceMatch) {
      const path = workspaceByName.get(workspaceMatch[1]) ?? workspaceMatch[2]
      if (nodes.has(`yarn:project:${path}`)) for (const descriptor of descriptors) mapDescriptor(descriptor, `yarn:project:${path}`)
      else warnings.push(`Could not match Yarn workspace ${workspaceMatch[1]} to a package.json manifest.`)
      continue
    }
    const version = typeof value.version === "string" ? value.version : null
    if (!version) { warnings.push(`Yarn entry ${key} has no version and was ignored.`); continue }
    const normalName = descriptors.map(descriptorName).find((name, index) => name && !aliasTarget(descriptors[index]))
    const name = descriptorName(resolution) ?? normalName ?? descriptors.map(aliasTarget).find(Boolean) ?? descriptorName(descriptors[0])
    if (!name) { warnings.push(`Could not determine the package name for Yarn entry ${key}.`); continue }
    const id = `yarn:${name}@${version}:${externalEntries.size}`
    nodes.set(id, { id, kind: "package", name, version, runtime: "unknown", location: key, prod: false, dev: false })
    assertDependencyResearchBudget(options, "nodes", nodes.size)
    externalEntries.set(id, value)
    for (const descriptor of descriptors) mapDescriptor(descriptor, id)
    if (asRecord(value.peerDependencies) && Object.keys(value.peerDependencies as object).length) hasPeerContracts = true
  }

  const resolve = (name: string, requested: string, context: string): string | null => {
    if (/^(?:workspace:|link:|portal:)/.test(requested)) {
      const path = workspaceByName.get(name)
      if (path) return `yarn:project:${path}`
    }
    const ids = new Set<string>()
    for (const descriptor of descriptorCandidates(name, requested)) {
      for (const id of descriptorToIds.get(descriptor) ?? []) ids.add(id)
    }
    if (ids.size === 1) return [...ids][0]
    warnings.push(ids.size
      ? `Ambiguous Yarn resolution for ${name}@${requested} from ${context}.`
      : `Could not resolve ${name}@${requested} from ${context}.`)
    return null
  }

  const edges: DependencyResearchEdge[] = []
  const addEdge = (edge: DependencyResearchEdge) => {
    edges.push(edge)
    assertDependencyResearchBudget(options, "edges", edges.length)
  }
  for (const [path, manifest] of manifestRecords) {
    for (const [group, scope] of [["dependencies", "production"], ["optionalDependencies", "production"], ["devDependencies", "development"]] as const) {
      for (const [name, requested] of dependencyEntries(manifest[group] as LockValue)) {
        const to = resolve(name, requested, `importer ${path}`)
        if (to) addEdge({ from: `yarn:project:${path}`, to, name, requested,
          kind: to.startsWith("yarn:project:") ? "workspace" : group === "devDependencies" ? "development" : group === "optionalDependencies" ? "optional" : "dependency",
          scope })
      }
    }
  }
  for (const [from, value] of externalEntries) {
    const optionalMeta = asRecord(value.dependenciesMeta)
    for (const [group, source] of [["dependencies", value.dependencies], ["optionalDependencies", value.optionalDependencies]] as const) {
      for (const [name, requested] of dependencyEntries(source as LockValue)) {
        const to = resolve(name, requested, nodes.get(from)?.location ?? from)
        const meta = asRecord(optionalMeta?.[name])
        const optional = group === "optionalDependencies" || meta?.optional === true || meta?.optional === "true"
        if (to) addEdge({ from, to, name, requested, kind: optional ? "optional" : "dependency", scope: "production" })
      }
    }
  }
  if (hasPeerContracts) warnings.push("Yarn derives virtual peer instances during resolution and doesn't persist them in yarn.lock; peer-specific paths are merged by base resolution.")
  return finalizeDependencyResearch("yarn", "yarn.lock", nodes, edges, options, warnings)
}
