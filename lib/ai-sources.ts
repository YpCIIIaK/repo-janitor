/** Server-side, bounded source lookup. Never fetch URLs supplied by a finding. */
import { readJson } from "@/lib/request-json"

export interface AiSource {
  label: string
  url: string
  status: "fetched" | "unavailable"
  checkedAt: string
  facts?: string
}

type Entry = { expires: number; value: Promise<AiSource> }
const cache = new Map<string, Entry>()
const MAX_ENTRIES = 256
let active = 0
const text = (v: unknown, max = 1000) => typeof v === "string" ? v.slice(0, max) : ""
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []

async function lookup(label: string, url: string, summarize: (data: Record<string, unknown>) => string): Promise<AiSource> {
  const hit = cache.get(url)
  if (hit && hit.expires > Date.now()) return hit.value
  // Bound both stored entries and concurrent outbound requests across callers.
  if (cache.size >= MAX_ENTRIES) {
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key)
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  }
  const entry: Entry = { expires: Date.now() + 3_600_000, value: Promise.resolve(null as never) }
  entry.value = (async () => {
    const checkedAt = new Date().toISOString()
    if (active >= 12) {
      entry.expires = Date.now() + 1000
      return { label, url, checkedAt, status: "unavailable" as const }
    }
    active++
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Repo-janitor-source-check" },
        redirect: "error", signal: AbortSignal.timeout(4000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error("Unavailable source")
      }
      const data = object(await readJson(response, 512 * 1024))
      const facts = summarize(data)
      if (!facts) throw new Error("Unrecognized source")
      return { label, url, checkedAt, status: "fetched" as const, facts }
    } catch {
      entry.expires = Date.now() + 60_000
      return { label, url, checkedAt, status: "unavailable" as const }
    } finally {
      active--
    }
  })()
  cache.set(url, entry)
  return entry.value
}

/** Public source identifiers only; no snippets, repository credentials, or arbitrary URLs leave the server. */
export async function lookupAiSources(prompt: string): Promise<AiSource[]> {
  const ids = [...new Set(prompt.match(/\b(?:GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}|CVE-\d{4}-\d{4,9})\b/gi) ?? [])]
    .sort((a, b) => Number(b.startsWith("GHSA")) - Number(a.startsWith("GHSA"))).slice(0, 4)
  const packages = new Set<string>()
  // Only npm-marked findings. Do not look up identically named PyPI/Rust packages in npm.
  for (const block of prompt.split(/(?=\[\d+\]\n|\n- \[(?:warning|critical)\])/)) {
    if (!/package\.json|(?:package-lock|npm-shrinkwrap)\.json|pnpm-lock\.yaml|yarn\.lock/.test(block)) continue
    const match = block.match(/(?:Finding: |(?:Dependency Funeral|Security): )((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@[^\s]+)? (?:has a known vulnerability|is |looks abandoned)/i)
    if (match && match[1].length <= 214) packages.add(match[1])
  }
  const sources = await Promise.all(ids.map((id) => lookup(`OSV ${id}`, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, (d) => {
    if (d.id !== id && !list(d.aliases).includes(id)) return ""
    return JSON.stringify({ id: d.id, aliases: list(d.aliases).slice(0, 10), withdrawn: d.withdrawn ?? null,
      summary: text(d.summary), details: text(d.details, 2400),
      affected: list(d.affected).slice(0, 6).map((a) => { const v = object(a); return { package: v.package, ranges: list(v.ranges).slice(0, 4) } }),
    }).slice(0, 6500)
  })))
  await Promise.all([...packages].slice(0, 2).map(async (name) => {
    let repository = ""
    const npm = await lookup(`npm ${name} latest`, `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, (d) => {
      if (d.name !== name || typeof d.version !== "string") return ""
      repository = text(object(d.repository).url, 300)
      return JSON.stringify({ name, latest: d.version, deprecated: text(d.deprecated), repository })
    })
    sources.push(npm)
    // Cached metadata must also support following the repository reference.
    if (!repository && npm.facts) repository = text(object(JSON.parse(npm.facts)).repository, 300)
    const repo = repository.match(/^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
    if (repo && repo[1] !== "." && repo[1] !== ".." && repo[2] !== "." && repo[2] !== "..") {
      sources.push(await lookup(`GitHub ${repo[1]}/${repo[2]}`, `https://api.github.com/repos/${repo[1]}/${repo[2]}`, (d) =>
        typeof d.archived === "boolean" ? JSON.stringify({ repository: d.full_name, archived: d.archived, disabled: d.disabled, pushedAt: d.pushed_at }) : ""))
    }
  }))
  return sources
}

export function clearAiSourcesCache(): void { cache.clear() }
