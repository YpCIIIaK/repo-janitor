#!/usr/bin/env node
/**
 * Scan every corpus repo whose result is missing or was produced by different
 * scanner code (see fingerprint.mjs), one clone at a time (clones are dropped
 * after scanning). Safe to run again after an interruption. A confidence-only
 * change does not make results stale: run rescore.mjs instead.
 *
 *   node benchmark/resume.mjs
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scanFingerprint, scannerFingerprints, staleScanners } from "./fingerprint.mjs"
import { readInventory } from "./inventory.mjs"
import { mayProduce } from "./scanner-inputs.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const fingerprint = scanFingerprint()
const fps = scannerFingerprints()
const stampOnly = []
const plans = corpus.map((r) => {
  const f = join(here, ".results", `${r.name}.json`)
  let prev = null
  try { prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null } catch { prev = null }
  let plan = staleScanners(prev, r.sha, fps, fingerprint)
  // Same filter as run.mjs: a scanner with no input files here and no finding
  // last time cannot change this result.
  const inv = plan && plan.length ? readInventory(r.name, r.sha) : null
  if (inv) {
    const had = new Set(prev.findings.map((f) => f.scanner))
    const skipped = plan.filter((id) => !mayProduce(id, inv) && !had.has(id))
    plan = plan.filter((id) => !skipped.includes(id))
    if (skipped.length && !plan.length) stampOnly.push(r.name)
  }
  return { name: r.name, plan }
})
// Stamp per-scanner fingerprints on results that are current but predate them.
for (const p of plans) {
  if (!p.plan || p.plan.length) continue
  const f = join(here, ".results", `${p.name}.json`)
  const prev = JSON.parse(readFileSync(f, "utf8"))
  if (!prev.scanners) writeFileSync(f, JSON.stringify({ ...prev, base: fps.base, scanners: fps.scanners }, null, 1))
}
// Repos where every stale scanner was skipped: record the new fingerprints, no scan.
for (const name of stampOnly) {
  const f = join(here, ".results", `${name}.json`)
  const prev = JSON.parse(readFileSync(f, "utf8"))
  writeFileSync(f, JSON.stringify({ ...prev, base: fps.base, scanners: fps.scanners }, null, 1))
}
if (stampOnly.length) console.log(`no input files for the changed scanners, marked current: ${stampOnly.length}`)
const stale = plans.filter((p) => p.plan === null || p.plan.length > 0).map((p) => p.name)
const full = plans.filter((p) => p.plan === null).length
const byScanner = {}
for (const p of plans) for (const id of p.plan ?? []) byScanner[id] = (byScanner[id] ?? 0) + 1
if (Object.keys(byScanner).length) console.log(`partial: ${Object.entries(byScanner).map(([k, v]) => `${k} ×${v}`).join(", ")}`)
if (full) console.log(`full scans: ${full}`)
console.log(`${stale.length} of ${corpus.length} repos need a scan`)
if (stale.length) {
  const result = spawnSync("node", [join(here, "run.mjs"), ...stale], {
    stdio: "inherit",
    env: { BENCH_DROP_CLONES: "1", ...process.env },
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
