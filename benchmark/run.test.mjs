import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

for (const mode of ["success", "exit-failure", "scanner-failure"]) {
  test(`benchmark preserves previous reports on ${mode}`, () => {
    const root = mkdtempSync(join(tmpdir(), "benchmark-run-"))
    try {
      const bench = join(root, "benchmark")
      const dist = join(root, "packages/cli/dist")
      const repo = join(root, "fixture")
      mkdirSync(join(bench, ".results"), { recursive: true })
      mkdirSync(dist, { recursive: true })
      mkdirSync(repo)
      execFileSync("git", ["init", "--quiet", repo])
      writeFileSync(join(repo, "README.md"), "fixture")
      execFileSync("git", ["-C", repo, "add", "."])
      execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"])
      const sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
      writeFileSync(join(bench, "corpus.json"), JSON.stringify([{ name: "fixture", url: repo, sha }]))
      copyFileSync(new URL("./run.mjs", import.meta.url), join(bench, "run.mjs"))
      copyFileSync(new URL("./fingerprint.mjs", import.meta.url), join(bench, "fingerprint.mjs"))
      // A core build exporting what run.mjs uses to merge partial scans.
      mkdirSync(join(root, "packages/core/dist"), { recursive: true })
      writeFileSync(join(root, "packages/core/dist/index.js"), "export const computeScore = () => 100\nexport const scoreToGrade = () => 'A'\n")
      // Scanner sources the fingerprint hashes, older than the CLI build below.
      for (const d of ["packages/core/src", "packages/cli/src"]) {
        mkdirSync(join(root, d), { recursive: true })
        writeFileSync(join(root, d, "index.ts"), "export {}\n")
        utimesSync(join(root, d, "index.ts"), new Date(2000, 0, 1), new Date(2000, 0, 1))
      }
      writeFileSync(join(dist, "index.js"), `
        const fs = require('node:fs');
        const output = process.argv[process.argv.indexOf('--output') + 1];
        fs.writeFileSync(output, JSON.stringify({issues: [], diagnostics: {failedScanners: ${mode === "scanner-failure" ? '["todo-debt"]' : "[]"}}}));
        process.exit(${mode === "exit-failure" ? 1 : 0});
      `)
      for (const suffix of ["json", "report.json"]) writeFileSync(join(bench, `.results/fixture.${suffix}`), "previous")
      const result = spawnSync(process.execPath, [join(bench, "run.mjs"), "fixture"], {
        encoding: "utf8", env: { ...process.env, BENCH_JOBS: "1", BENCH_DROP_CLONES: "0", BENCH_KEEP_TREES: "1" },
      })
      assert.equal(result.status, mode === "success" ? 0 : 1, result.stderr)
      for (const suffix of ["json", "report.json"]) {
        const saved = readFileSync(join(bench, `.results/fixture.${suffix}`), "utf8")
        if (mode === "success") assert.doesNotThrow(() => JSON.parse(saved))
        else assert.equal(saved, "previous")
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("benchmark refuses to scan with a CLI older than its sources", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-stale-"))
  try {
    const bench = join(root, "benchmark")
    mkdirSync(join(bench, ".results"), { recursive: true })
    mkdirSync(join(root, "packages/cli/dist"), { recursive: true })
    writeFileSync(join(bench, "corpus.json"), "[]")
    copyFileSync(new URL("./run.mjs", import.meta.url), join(bench, "run.mjs"))
    copyFileSync(new URL("./fingerprint.mjs", import.meta.url), join(bench, "fingerprint.mjs"))
    writeFileSync(join(root, "packages/cli/dist/index.js"), "")
    utimesSync(join(root, "packages/cli/dist/index.js"), new Date(2000, 0, 1), new Date(2000, 0, 1))
    for (const d of ["packages/core/src", "packages/cli/src"]) {
      mkdirSync(join(root, d), { recursive: true })
      writeFileSync(join(root, d, "index.ts"), "export {}\n")
    }
    const result = spawnSync(process.execPath, [join(bench, "run.mjs")], { encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /older than/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
