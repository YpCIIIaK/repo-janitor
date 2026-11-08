import { test } from "node:test"
import assert from "node:assert/strict"
import { parseExpected, evaluate } from "./owasp-score.mjs"
const expected = parseExpected(`# test name, category, real vulnerability, cwe
BenchmarkTest00001,sqli,true,89
BenchmarkTest00002,sqli,false,89
BenchmarkTest00003,cmdi,true,78
BenchmarkTest00004,cmdi,false,78
BenchmarkTest00005,crypto,true,327`)
const names = expected.map(x => x.name)
const finding = (name, rule, confidence = "high") => ({ id: `insecure-${rule}-${name}:3`, scanner: "insecure-code", rule, confidence, location: `src/${name}.java:3` })
test("counts each case/CWE once and excludes unsupported Java families", () => {
  const f = finding(names[0], "sql-interpolated")
  const result = evaluate(expected, { findings: [f, f, finding(names[1], "sql-interpolated")] }, names)
  assert.deepEqual(result.totals, { tp: 1, fp: 1, fn: 1, tn: 1 })
  assert.deepEqual(result.coverage.unsupportedCwes, { 327: 1 })
  assert.equal(result.coverage.evaluated, 4)
})
test("wrong CWE does not count as detection, missing source excluded", () => {
  const result = evaluate(expected, { findings: [finding(names[0], "exec-interpolated")] }, names.slice(0, 3))
  assert.deepEqual(result.totals, { tp: 0, fp: 0, fn: 2, tn: 1 })
  assert.deepEqual(result.coverage.missingCases, [names[3]])
  assert.equal(result.limitations.negativeCasesReliable, false)
})
test("CLI reports include hidden findings by default and can show visible-only metrics", () => {
  const report = { issues: [], lowConfidence: [finding(names[0], "sql-interpolated", "low")] }
  assert.equal(evaluate(expected, report, names).totals.tp, 1)
  assert.equal(evaluate(expected, report, names, { confidence: "visible" }).totals.tp, 0)
})
test("cap detection includes hidden findings even in visible-only mode", () => {
  const f = finding(names[0], "sql-interpolated", "low")
  const result = evaluate(expected, { findings: [f, f] }, names, { confidence: "visible", totalCap: 2, fileCap: 2 })
  assert.equal(result.limitations.globalCapSuspected, true)
  assert.deepEqual(result.limitations.cappedFiles, [`src/${names[0]}.java`])
  assert.equal(result.limitations.negativeCasesReliable, false)
})
test("rejects duplicate and invalid truth instead of silently corrupting totals", () => {
  assert.throws(() => parseExpected("BenchmarkTest00001,sqli,true,89\nBenchmarkTest00001,sqli,false,89"), /Duplicate/)
  assert.throws(() => parseExpected("BenchmarkTest00001,sqli,maybe,89"), /Invalid/)
})

test("CLI reads an external checkout and reports mismatched scan provenance", async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join, resolve } = await import("node:path")
  const { execFileSync } = await import("node:child_process")
  const dir = mkdtempSync(join(tmpdir(), "owasp-score-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "expectedresults-test.csv"), "BenchmarkTest00001,sqli,true,89\n")
  writeFileSync(join(dir, "BenchmarkTest00001.java"), "// Independently authored synthetic fixture\n")
  writeFileSync(join(dir, "result.json"), JSON.stringify({ sha: "mismatch", findings: [finding("BenchmarkTest00001", "sql-interpolated")] }))
  execFileSync("git", ["init", "--quiet", dir])
  execFileSync("git", ["-C", dir, "add", "."])
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic fixture"])
  const result = JSON.parse(execFileSync(process.execPath, [resolve("benchmark/owasp-score.mjs"), "--checkout", dir, "--results", join(dir, "result.json")], { encoding: "utf8" }))
  assert.equal(result.totals.tp, 1)
  assert.equal(result.provenance.sameCommit, false)
  assert.equal(result.limitations.negativeCasesReliable, false)
})


test("normalizes benchmark taxonomy rule IDs and raw CLI findings without rule metadata", () => {
  const benchmark = { ...finding(names[0], "sql-interpolated"), rule: "insecure-sql-interpolated" }
  const raw = { id: `insecure-exec-interpolated-src/${names[2]}.java:4`, location: `src/${names[2]}.java:4`, confidence: "high" }
  assert.equal(evaluate(expected, { findings: [benchmark] }, names).totals.tp, 1)
  assert.equal(evaluate(expected, { issues: [raw] }, names).totals.tp, 1)
  const wrongPrefix = { ...raw, id: `insecure-exec-interpolatedish-src/${names[2]}.java:4`, location: `src/${names[2]}.java:4` }
  assert.equal(evaluate(expected, { issues: [wrongPrefix] }, names).totals.tp, 0)
})


test("reports OWASP package paths excluded by scanner instead of claiming analyzed negatives", () => {
  const result = evaluate(expected, { findings: [] }, names, { pathFilters: "legacy", sourcePaths: { [names[0]]: `src/main/java/org/owasp/benchmark/testcode/${names[0]}.java` } })
  assert.equal(result.coverage.excludedSourceCases.length, 1)
  assert.equal(result.coverage.evaluated, 3)
  assert.equal(result.totals.fn, 1)
  assert.equal(result.limitations.negativeCasesReliable, false)
})


test("current production namespaces are not excluded while outer benchmark trees remain excluded", () => {
  const result = evaluate(expected, { findings: [] }, names, { sourcePaths: { [names[0]]: `src/main/java/org/owasp/benchmark/testcode/${names[0]}.java`, [names[2]]: `benchmark/app/src/main/java/${names[2]}.java` } })
  assert.equal(result.coverage.excludedSourceCases.length, 1)
  assert.equal(result.coverage.excludedSourceCases[0].name, names[2])
  assert.equal(result.totals.fn, 1)
})
