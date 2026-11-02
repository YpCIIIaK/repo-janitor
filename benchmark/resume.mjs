#!/usr/bin/env node
/**
 * Scan every corpus repo whose result is missing or older than the current CLI
 * build, one clone at a time (clones are dropped after scanning). Safe to run
 * again after an interruption: finished repos are skipped.
 *
 *   node benchmark/resume.mjs
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const built = statSync(join(here, "..", "packages", "cli", "dist")).mtimeMs
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
const stale = corpus
  .map((r) => r.name)
  .filter((n) => {
    const f = join(here, ".results", `${n}.json`)
    return !existsSync(f) || statSync(f).mtimeMs < built
  })
console.log(`${stale.length} of ${corpus.length} repos need a scan`)
if (stale.length) {
  spawnSync("node", [join(here, "run.mjs"), ...stale], {
    stdio: "inherit",
    env: { BENCH_DROP_CLONES: "1", BENCH_JOBS: "6", ...process.env },
  })
}
