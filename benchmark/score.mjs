#!/usr/bin/env node
/**
 * Precision of each scanner and rule against the hand-labelled findings.
 *
 *   pnpm bench:score            print the table, write REPORT.md
 *   pnpm bench:score --check    also fail if precision fell below baseline.json
 *   pnpm bench:score --update   rewrite baseline.json from the current numbers
 *
 * Labels live in benchmark/labels/<repo>.json as { "<finding id>": "tp" | "fp" }.
 * A labelled finding that no longer appears is a "gone" TP (lost recall) or a
 * fixed FP. Unlabelled findings are counted but not judged.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const args = new Set(process.argv.slice(2))
const TOLERANCE = 0.02

const by = { scanner: new Map(), rule: new Map() }
const bump = (map, key, field) => {
  const row = map.get(key) ?? { tp: 0, fp: 0, unlabelled: 0, goneTp: 0 }
  row[field]++
  map.set(key, row)
}
let missing = 0

for (const repo of corpus) {
  const resultPath = join(here, ".results", `${repo.name}.json`)
  if (!existsSync(resultPath)) {
    missing++
    continue
  }
  const { findings } = JSON.parse(readFileSync(resultPath, "utf8"))
  const labelPath = join(here, "labels", `${repo.name}.json`)
  const labels = existsSync(labelPath) ? JSON.parse(readFileSync(labelPath, "utf8")) : {}
  const seen = new Set()
  for (const f of findings) {
    seen.add(f.id)
    const verdict = labels[f.id]
    const field = verdict === "tp" ? "tp" : verdict === "fp" ? "fp" : "unlabelled"
    bump(by.scanner, f.scanner, field)
    bump(by.rule, f.rule, field)
  }
  for (const [id, verdict] of Object.entries(labels)) {
    if (verdict !== "tp" || seen.has(id)) continue
    // The scanner/rule of a vanished finding is not in the results; record it
    // under a rule derived from the id so it still shows up.
    bump(by.scanner, "(gone)", "goneTp")
    bump(by.rule, "(gone)", "goneTp")
  }
}

const precision = (r) => (r.tp + r.fp ? r.tp / (r.tp + r.fp) : null)
const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`)

function table(map, title) {
  const rows = [...map.entries()].sort((a, b) => (precision(a[1]) ?? 2) - (precision(b[1]) ?? 2) || a[0].localeCompare(b[0]))
  const lines = [`### ${title}`, "", "| | precision | TP | FP | unlabelled | lost TP |", "|---|---:|---:|---:|---:|---:|"]
  for (const [k, r] of rows) lines.push(`| ${k} | ${pct(precision(r))} | ${r.tp} | ${r.fp} | ${r.unlabelled} | ${r.goneTp} |`)
  return lines.join("\n")
}

const all = [...by.scanner.values()].reduce(
  (a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, unlabelled: a.unlabelled + r.unlabelled, goneTp: a.goneTp + r.goneTp }),
  { tp: 0, fp: 0, unlabelled: 0, goneTp: 0 },
)
const report = [
  "# Scanner benchmark",
  "",
  `${corpus.length - missing}/${corpus.length} repos scanned offline at pinned commits. ` +
    `Overall precision **${pct(precision(all))}** (${all.tp} TP, ${all.fp} FP, ${all.unlabelled} unlabelled, ${all.goneTp} lost TP).`,
  "",
  table(by.scanner, "By scanner"),
  "",
  table(by.rule, "By rule"),
  "",
].join("\n")
writeFileSync(join(here, "REPORT.md"), report)
console.log(report)

const baselinePath = join(here, "baseline.json")
const current = Object.fromEntries(
  [...by.scanner.entries()].filter(([, r]) => precision(r) !== null).map(([k, r]) => [k, Number(precision(r).toFixed(3))]),
)
if (args.has("--update")) {
  writeFileSync(baselinePath, JSON.stringify({ overall: Number(precision(all).toFixed(3)), scanners: current, lostTp: all.goneTp }, null, 2) + "\n")
  console.log("baseline.json updated")
}
if (args.has("--check")) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8"))
  const problems = []
  if (missing) problems.push(`${missing} repos have no results — run pnpm bench:run`)
  for (const [k, p] of Object.entries(base.scanners)) {
    if (current[k] !== undefined && current[k] < p - TOLERANCE) problems.push(`${k}: precision ${pct(current[k])} < baseline ${pct(p)}`)
  }
  if (all.goneTp > base.lostTp) problems.push(`${all.goneTp - base.lostTp} confirmed findings disappeared`)
  if (problems.length) {
    console.error("\nBenchmark regressions:\n- " + problems.join("\n- "))
    process.exit(1)
  }
  console.log("\nNo regressions against baseline.")
}
