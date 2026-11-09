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

const here = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const fingerprint = scanFingerprint()
const fps = scannerFingerprints()
const plans = corpus.map((r) => {
  const f = join(here, ".results", `${r.name}.json`)
  let prev = null
  try { prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null } catch { prev = null }
  return { name: r.name, plan: staleScanners(prev, r.sha, fps, fingerprint) }
})
// Stamp per-scanner fingerprints on results that are current but predate them.
for (const p of plans) {
  if (!p.plan || p.plan.length) continue
  const f = join(here, ".results", `${p.name}.json`)
  const prev = JSON.parse(readFileSync(f, "utf8"))
  if (!prev.scanners) writeFileSync(f, JSON.stringify({ ...prev, base: fps.base, scanners: fps.scanners }, null, 1))
}
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
