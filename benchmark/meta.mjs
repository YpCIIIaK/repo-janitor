#!/usr/bin/env node
/**
 * Public metadata for every corpus repo, from deps.dev (Google's open
 * dependency API): stars, forks, license, and the OpenSSF Scorecard result
 * deps.dev already computed. No key needed; nothing is sent but repo names.
 *
 *   node benchmark/meta.mjs            fetch what is missing → benchmark/meta.json
 *   node benchmark/meta.mjs --refresh  refetch everything
 *
 * Kept separate from the scans: it is metadata about the projects, not
 * findings, and it changes on its own schedule.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const outPath = join(here, "meta.json")
const refresh = process.argv.includes("--refresh")
const meta = existsSync(outPath) && !refresh ? JSON.parse(readFileSync(outPath, "utf8")) : {}

/** Scorecard checks worth comparing with our own rules. */
const CHECKS = [
  "Pinned-Dependencies", "Token-Permissions", "Branch-Protection", "Code-Review", "Maintained",
  "SAST", "Dependency-Update-Tool", "Security-Policy", "Signed-Releases", "Vulnerabilities", "CI-Tests", "Fuzzing",
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchOne(repo) {
  const m = /github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(repo.url)
  if (!m) return { error: "not a GitHub URL" }
  const key = encodeURIComponent(`github.com/${m[1]}/${m[2]}`.toLowerCase())
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.deps.dev/v3/projects/${key}`, { signal: AbortSignal.timeout(20000) })
      if (res.status === 404) return { missing: true }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      const sc = j.scorecard
      return {
        stars: j.starsCount ?? null,
        forks: j.forksCount ?? null,
        license: j.license ?? null,
        scorecard: sc
          ? {
              score: sc.overallScore ?? null,
              date: sc.date?.slice(0, 10) ?? null,
              checks: Object.fromEntries((sc.checks ?? []).filter((c) => CHECKS.includes(c.name)).map((c) => [c.name, c.score])),
            }
          : null,
      }
    } catch (e) {
      if (attempt === 3) return { error: String(e.message ?? e) }
      await sleep(2000 * 2 ** attempt)
    }
  }
}

const queue = corpus.filter((r) => !meta[r.name] || meta[r.name].error)
let done = 0
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const r = queue.shift()
      meta[r.name] = await fetchOne(r)
      if (++done % 200 === 0) {
        writeFileSync(outPath, JSON.stringify(meta) + "\n")
        console.log(`${done} fetched`)
      }
    }
  }),
)
// Drop repos that left the corpus; sort keys for stable diffs.
const names = new Set(corpus.map((r) => r.name))
const sorted = Object.fromEntries(Object.keys(meta).filter((k) => names.has(k)).sort().map((k) => [k, meta[k]]))
writeFileSync(outPath, JSON.stringify(sorted, null, 0).replace(/},"/g, '},\n"') + "\n")
const v = Object.values(sorted)
console.log(`meta for ${v.length} repos: ${v.filter((x) => x.stars != null).length} with stars, ${v.filter((x) => x.scorecard).length} with Scorecard, ${v.filter((x) => x.missing).length} unknown to deps.dev, ${v.filter((x) => x.error).length} errors`)
