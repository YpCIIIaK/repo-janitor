#!/usr/bin/env node
/**
 * Print unlabelled findings to review, at most N per (repo, rule), with the
 * source line around each location. Pipe to a file, judge, then record the
 * verdicts in benchmark/labels/<repo>.json.
 *
 *   pnpm bench:sample [--per 3] [repo ...]
 *   pnpm bench:sample --spread 12        up to 12 unlabelled per rule across
 *                                        the whole corpus, one repo at a time
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const perIdx = argv.indexOf("--per")
const per = perIdx >= 0 ? Number(argv[perIdx + 1]) : 3
const spreadIdx = argv.indexOf("--spread")
const spread = spreadIdx >= 0 ? Number(argv[spreadIdx + 1]) : 0
const only = argv.filter(
  (a, i) => a !== "--per" && i !== perIdx + 1 && a !== "--spread" && i !== spreadIdx + 1,
)
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))

// Stable pseudo-random order so the same sample comes back every run.
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

function context(repo, location) {
  const m = /^(.+?):(\d+)$/.exec(location ?? "")
  if (!m) return ""
  const file = join(here, ".cache", repo, m[1])
  if (!existsSync(file)) return ""
  const lines = readFileSync(file, "utf8").split("\n")
  const n = Number(m[2])
  return lines
    .slice(Math.max(0, n - 3), n + 2)
    .map((l, i) => `      ${Math.max(1, n - 2) + i === n ? ">" : " "} ${l.slice(0, 160)}`)
    .join("\n")
}

function show(repoName, f) {
  console.log(`## ${repoName} | ${f.rule} | ${f.severity}\n  id: ${f.id}\n  ${f.title}\n  at: ${f.location}`)
  if (f.evidence) console.log(`  evidence: ${f.evidence.slice(0, 200)}`)
  console.log(`  detail: ${(f.detail ?? "").slice(0, 300)}`)
  const ctx = context(repoName, f.location)
  if (ctx) console.log(ctx)
  console.log()
}

function load(repo) {
  const resultPath = join(here, ".results", `${repo.name}.json`)
  if (!existsSync(resultPath)) return null
  const labelPath = join(here, "labels", `${repo.name}.json`)
  const labels = existsSync(labelPath) ? JSON.parse(readFileSync(labelPath, "utf8")) : {}
  return { labels, findings: JSON.parse(readFileSync(resultPath, "utf8")).findings }
}

if (spread > 0) {
  // rule -> repo -> unlabelled findings
  const byRule = new Map()
  const labelledPerRule = new Map()
  for (const repo of corpus) {
    if (only.length && !only.includes(repo.name)) continue
    const data = load(repo)
    if (!data) continue
    for (const f of data.findings) {
      if (data.labels[f.id]) {
        // Counts only labels inside the repos being sampled, so a new batch of
        // repos gets its own sample instead of inheriting the old one's quota.
        labelledPerRule.set(f.rule, (labelledPerRule.get(f.rule) ?? 0) + 1)
        continue
      }
      if (!byRule.has(f.rule)) byRule.set(f.rule, new Map())
      const m = byRule.get(f.rule)
      if (!m.has(repo.name)) m.set(repo.name, [])
      m.get(repo.name).push(f)
    }
  }
  for (const [, m] of byRule) for (const list of m.values()) list.sort((a, b) => hash(a.id) - hash(b.id))
  for (const [rule, m] of [...byRule].sort()) {
    let budget = Math.max(0, spread - (labelledPerRule.get(rule) ?? 0))
    const repos = [...m.keys()].sort((a, b) => hash(a) - hash(b))
    for (let round = 0; budget > 0; round++) {
      let took = false
      for (const r of repos) {
        const f = m.get(r)[round]
        if (!f || budget <= 0) continue
        show(r, f)
        budget--
        took = true
      }
      if (!took) break
    }
  }
  process.exit(0)
}

for (const repo of corpus) {
  if (only.length && !only.includes(repo.name)) continue
  const resultPath = join(here, ".results", `${repo.name}.json`)
  if (!existsSync(resultPath)) continue
  const labelPath = join(here, "labels", `${repo.name}.json`)
  const labels = existsSync(labelPath) ? JSON.parse(readFileSync(labelPath, "utf8")) : {}
  const { findings } = JSON.parse(readFileSync(resultPath, "utf8"))
  const groups = new Map()
  for (const f of findings) {
    if (!groups.has(f.rule)) groups.set(f.rule, [])
    groups.get(f.rule).push(f)
  }
  for (const [rule, list] of groups) {
    const labelled = list.filter((f) => labels[f.id]).length
    const todo = list
      .filter((f) => !labels[f.id])
      .sort((a, b) => hash(a.id) - hash(b.id))
      .slice(0, Math.max(0, per - labelled))
    for (const f of todo) {
      console.log(`## ${repo.name} | ${rule} | ${f.severity}\n  id: ${f.id}\n  ${f.title}\n  at: ${f.location}`)
      if (f.evidence) console.log(`  evidence: ${f.evidence.slice(0, 200)}`)
      console.log(`  detail: ${(f.detail ?? "").slice(0, 300)}`)
      const ctx = context(repo.name, f.location)
      if (ctx) console.log(ctx)
      console.log()
    }
  }
}
