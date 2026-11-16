import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { classOf, judge, judgeExpected, loadCases, run, summarise } from "./recall.mjs"

test("rule ids map to vulnerability classes", () => {
  assert.equal(classOf("insecure-sql-interpolated"), "sqli")
  assert.equal(classOf("insecure-php-reflected-xss"), "xss")
  assert.equal(classOf("insecure-py-os-system"), "cmdi")
  assert.equal(classOf("insecure-php-unserialize"), "deserialization")
  assert.equal(classOf("todo"), null)
})

const f = (rule, file) => ({ rule, file, line: 1 })

test("hit: the fix removes a finding of the case's class in a changed file", () => {
  const c = { class: "sqli" }
  assert.equal(judge(c, [f("insecure-sql-interpolated", "a.php")], [], ["a.php"]).verdict, "hit")
})

test("near: flagged in both versions; miss: nothing of that class in changed files", () => {
  const c = { class: "sqli" }
  const both = [f("insecure-sql-interpolated", "a.php")]
  assert.equal(judge(c, both, both, ["a.php"]).verdict, "near")
  assert.equal(judge(c, [f("insecure-sql-interpolated", "other.php")], [], ["a.php"]).verdict, "miss")
  assert.equal(judge(c, [f("insecure-py-os-system", "a.php")], [], ["a.php"]).verdict, "miss")
})

test("summary: recall = hit / non-error cases, per engine, language and class", () => {
  const rows = summarise([
    { engine: "fast", language: "php", class: "sqli", verdict: "hit" },
    { engine: "fast", language: "php", class: "sqli", verdict: "near" },
    { engine: "fast", language: "php", class: "sqli", verdict: "error" },
  ])
  assert.deepEqual(rows[0], { engine: "fast", language: "php", class: "sqli", cases: 3, hit: 1, near: 1, miss: 0, error: 1, clean: 0, fp: 0, recall: 0.5 })
})

const cli = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url))
test("end to end on fixtures: the fast engine finds PHP SQLi and Python command injection", { skip: !existsSync(cli) && "CLI not built" }, () => {
  const cases = loadCases(fileURLToPath(new URL("./recall/fixtures", import.meta.url))).filter((c) => ["fixture-php-sqli", "fixture-py-cmdi"].includes(c.id))
  const results = run(cases, ["fast"])
  assert.deepEqual(results.map((r) => [r.id, r.verdict]).sort(), [["fixture-php-sqli", "hit"], ["fixture-py-cmdi", "hit"]])
})

test("expect mode: vulnerable files → hit/miss, clean files → clean/fp", () => {
  const finding = [{ rule: "insecure-sql-interpolated", file: "low.php", line: 3 }]
  assert.equal(judgeExpected({ class: "sqli", expect: "vulnerable", files: ["low.php"] }, finding).verdict, "hit")
  assert.equal(judgeExpected({ class: "sqli", expect: "vulnerable", files: ["high.php"] }, finding).verdict, "miss")
  assert.equal(judgeExpected({ class: "sqli", expect: "clean", files: ["impossible.php"] }, finding).verdict, "clean")
  assert.equal(judgeExpected({ class: "sqli", expect: "clean", files: ["low.php"] }, finding).verdict, "fp")
})
