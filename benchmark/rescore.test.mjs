import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

test("rescore updates legacy and modern online snapshots, preserves taint confidence and rescales other insecure-code rules", () => {
  const root = mkdtempSync(join(tmpdir(), "janitor-rescore-"))
  try {
    const bench = join(root, "benchmark")
    const results = join(bench, ".results")
    mkdirSync(results, { recursive: true })
    mkdirSync(join(root, "packages/core/src"), { recursive: true })
    mkdirSync(join(root, "packages/core/dist"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "packages/core/src/confidence-data.ts"), "// calibration input\n")
    // Exercise the tool's IO against a new scale without rebuilding the real engine.
    writeFileSync(join(root, "packages/core/dist/index.js"), `
      export const confidenceOf = rule => rule === "vuln" ? "medium" : "low";
      export const computeScore = () => 100;
      export const scoreToGrade = () => "A";
      export const INJECTION_RULES = new Set(["sql-interpolated"]);
    `)
    copyFileSync(new URL("./rescore.mjs", import.meta.url), join(bench, "rescore.mjs"))
    writeFileSync(join(bench, "corpus.json"), JSON.stringify([{ name: "legacy" }, { name: "modern" }]))
    const tainted = { id: "insecure-sql-interpolated-a.py:3", scanner: "insecure-code", rule: "insecure-sql-interpolated", confidence: "high" }
    // Not taint-gated: takes the per-rule scale like any other scanner's finding.
    const xxe = { id: "insecure-java-xxe-X.java:9", scanner: "insecure-code", rule: "insecure-java-xxe", confidence: "medium" }
    for (const name of ["legacy", "modern"]) {
      writeFileSync(join(results, `${name}.json`), JSON.stringify({ sha: "pin", findings: [tainted, xxe] }))
      writeFileSync(join(results, `${name}.report.json`), JSON.stringify({ score: 100, issues: [tainted, xxe] }))
    }
    const legacy = { sha: "pin", checkedAt: "2026-11-09", findings: [{ id: "vuln-package-CVE", confidence: "low" }] }
    const modern = { sha: "pin", scanners: ["license-risk"], findings: [{ id: "license-proprietary-package", scanner: "license-risk", confidence: "high" }] }
    writeFileSync(join(results, "legacy.osv.json"), JSON.stringify(legacy))
    writeFileSync(join(results, "modern.osv.json"), JSON.stringify(modern))
    const run = spawnSync(process.execPath, [join(bench, "rescore.mjs")], { encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
    const load = file => JSON.parse(readFileSync(join(results, file), "utf8"))
    assert.deepEqual(load("legacy.osv.json"), { ...legacy, findings: [{ ...legacy.findings[0], confidence: "medium" }] })
    assert.deepEqual(load("modern.osv.json"), { ...modern, findings: [{ ...modern.findings[0], confidence: "low" }] })
    assert.deepEqual(load("legacy.json").findings, [tainted, { ...xxe, confidence: "low" }])
    assert.deepEqual(load("modern.report.json").issues, [tainted])
    assert.deepEqual(load("modern.report.json").lowConfidence, [{ ...xxe, confidence: "low" }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
