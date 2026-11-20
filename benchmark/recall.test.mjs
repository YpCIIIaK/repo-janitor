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

test("a generic scanner id does not hide the class in a finding id", () => {
  const finding = { rule: "insecure-code", id: "insecure-js-redos-lib/a.js:3", file: "lib/a.js", line: 3 }
  assert.equal(judge({ class: "redos" }, [finding], [], ["lib/a.js"]).verdict, "hit")
  assert.equal(judge({ class: "redos" }, [finding], [finding], ["lib/a.js"]).verdict, "near")
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

test("CWE-reporting engines and advisories map through CWE ids", async () => {
  const { sourceFiles } = await import("./recall.mjs")
  assert.equal(classOf("cwe-89"), "sqli")
  assert.equal(classOf("cwe-1321"), "prototype-pollution")
  assert.equal(classOf("cwe-1333"), "redos")
  assert.equal(classOf("cwe-400"), null)
  assert.equal(classOf("cwe-9999"), null)
  assert.deepEqual(sourceFiles(["lib/a.js", "test/a.js", "a.test.ts", "README.md", "x_test.go"], "javascript"), ["lib/a.js"])
})

test("advisories: one fix commit and a mapped CWE make a case; picks are stable and one per commit", async () => {
  const { caseOf, pick } = await import("./recall-advisories.mjs")
  const adv = (id, cwe, refs) => ({ id, database_specific: { cwe_ids: [cwe] }, references: refs.map((url) => ({ url })) })
  const fix = "https://github.com/o/r/commit/" + "a".repeat(40)
  const c = caseOf(adv("GHSA-1", "CWE-89", [fix]), "PyPI")
  assert.deepEqual(c.source, { type: "git", url: "https://github.com/o/r", vulnerable: "parent", fixed: "a".repeat(40) })
  assert.equal(c.language, "python")
  assert.equal(caseOf(adv("GHSA-2", "CWE-89", [fix, fix.replace(/a+$/, "b".repeat(40))]), "PyPI"), null)
  assert.equal(caseOf(adv("GHSA-3", "CWE-1", [fix]), "PyPI"), null)
  assert.equal(caseOf(adv("GHSA-5", "CWE-400", [fix]), "npm"), null)
  assert.equal(caseOf(adv("GHSA-6", "CWE-1333", [fix]), "npm").class, "redos")
  const twins = [c, { ...c, id: "GHSA-4" }]
  assert.equal(pick(twins, 5, "s").length, 1)
  assert.deepEqual(pick([c], 5, "s"), pick([c], 5, "s"))
})

test("a deep finding counts for a file its data-flow path passes through", () => {
  const xss = [{ rule: "php-taint-xss", file: "index.php", line: 3, via: ["source/low.php", "index.php"] }]
  assert.equal(judgeExpected({ class: "xss", expect: "vulnerable", files: ["source/low.php"] }, xss).verdict, "hit")
})
