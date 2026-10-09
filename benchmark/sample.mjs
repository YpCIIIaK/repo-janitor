#!/usr/bin/env node
/**
 * Print unlabelled findings to review, at most N per (repo, rule), with the
 * source line around each location. Pipe to a file, judge, then record the
 * verdicts in benchmark/labels/<repo>.json.
 *
 *   pnpm bench:sample [--per 3] [repo ...]
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const perIdx = argv.indexOf("--per")
const per = perIdx >= 0 ? Number(argv[perIdx + 1]) : 3
const only = argv.filter((a, i) => a !== "--per" && i !== perIdx + 1)
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
