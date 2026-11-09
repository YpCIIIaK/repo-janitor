import { test } from "node:test"
import assert from "node:assert/strict"
import { inventoryOf } from "./inventory.mjs"
import { INPUTS, mayProduce } from "./scanner-inputs.mjs"

const inv = inventoryOf(["src/main.go", "go.mod", "Dockerfile", ".github/workflows/ci.yml", "docs/README.md", "ios/App.swift"], "s")

test("counts extensions, notable names and directories", () => {
  assert.equal(inv.files, 6)
  assert.equal(inv.exts.go, 1)
  assert.equal(inv.exts.swift, 1)
  assert.equal(inv.names["go.mod"], 1)
  assert.equal(inv.names.dockerfile, 1)
  assert.equal(inv.paths[".github/workflows/"], 1)
})

test("one Swift file in a Go repo still selects Swift-reading scanners", () => {
  assert.ok(mayProduce("insecure-code", inv))
})

test("scanners without inputs in the repo are skipped", () => {
  assert.equal(mayProduce("skipped-tests", inv), false) // no JS/TS or Python
  assert.equal(mayProduce("dependency-funeral", inv), false) // no package.json
  assert.ok(mayProduce("dockerfile", inv))
  assert.ok(mayProduce("workflow-security", inv))
  assert.ok(mayProduce("vulnerable-deps", inv)) // go.mod
})

test("broad and unknown scanners always run, and so does a missing inventory", () => {
  assert.ok(mayProduce("secrets", inv))
  assert.ok(mayProduce("some-new-scanner", inv))
  assert.ok(mayProduce("dead-code", null))
  for (const [id, spec] of Object.entries(INPUTS)) assert.ok(spec.always || spec.exts || spec.names || spec.paths, id)
})
