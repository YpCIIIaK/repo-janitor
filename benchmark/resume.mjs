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
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scanFingerprint } from "./fingerprint.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const built = statSync(join(here, "..", "packages", "cli", "dist")).mtimeMs
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const fingerprint = scanFingerprint()
const stale = corpus
  .filter((r) => {
    const f = join(here, ".results", `${r.name}.json`)
    if (!existsSync(f)) return true
    const res = JSON.parse(readFileSync(f, "utf8"))
    if (res.sha !== r.sha) return true
    if (res.fingerprint) return res.fingerprint !== fingerprint
    // Results written before fingerprints: current if newer than the CLI build.
    // Stamp them once so the next check does not depend on file times.
    if (statSync(f).mtimeMs < built) return true
    writeFileSync(f, JSON.stringify({ ...res, fingerprint }, null, 1))
    return false
  })
  .map((r) => r.name)
console.log(`${stale.length} of ${corpus.length} repos need a scan`)
if (stale.length) {
  const result = spawnSync("node", [join(here, "run.mjs"), ...stale], {
    stdio: "inherit",
    env: { BENCH_DROP_CLONES: "1", ...process.env },
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
