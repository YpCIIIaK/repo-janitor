import { test } from "node:test"
import assert from "node:assert/strict"
import { inventoryOf, treePaths } from "./inventory.mjs"
import { INPUTS, mayProduce, sparseGlobs } from "./scanner-inputs.mjs"

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


test("tree inventory preserves Unicode, quotes and newlines in Git filenames", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { execFileSync } = await import("node:child_process")
  const dir = mkdtempSync(join(tmpdir(), "janitor-inventory-"))
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" })
  try {
    git("init", "--quiet")
    for (const name of ['▶ пример.d.ts', 'quoted"name.js', 'line\nbreak.md']) writeFileSync(join(dir, name), "fixture")
    git("add", ".")
    git("-c", "user.name=Benchmark Test", "-c", "user.email=benchmark@example.invalid", "commit", "--quiet", "-m", "fixture")
    const paths = await treePaths(dir, "HEAD")
    const inv = inventoryOf(paths, "s")
    assert.equal(paths.length, 3)
    assert.equal(inv.exts.ts, 1)
    assert.equal(inv.exts.js, 1)
    assert.equal(inv.exts.md, 1)
    assert.ok(mayProduce("insecure-code", inv))
    assert.ok(mayProduce("broken-doc-links", inv))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Ruby debugger findings stay eligible for partial rescans", () => {
  assert.ok(mayProduce("leftover-debug", inventoryOf(["lib/plugin.rb"], "s")))
})


test("partial insecure-code checkout retains Rake and alternate C++ source files", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join, dirname } = await import("node:path")
  const { execFileSync } = await import("node:child_process")
  const root = mkdtempSync(join(tmpdir(), "janitor-sparse-"))
  const repo = join(root, "source"), checkout = join(root, "checkout")
  const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" })
  const paths = ["rakelib/lint.rake", "native/verify.cxx", "include/verify.hxx"]
  try {
    mkdirSync(repo)
    git(repo, "init", "--quiet")
    for (const path of [...paths, "docs/unrelated.txt"]) {
      mkdirSync(dirname(join(repo, path)), { recursive: true })
      writeFileSync(join(repo, path), "fixture\n")
    }
    git(repo, "add", ".")
    git(repo, "-c", "user.name=Benchmark Test", "-c", "user.email=benchmark@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture")
    execFileSync("git", ["clone", "--quiet", "--no-checkout", repo, checkout])
    git(checkout, "sparse-checkout", "set", "--no-cone", ...sparseGlobs(["insecure-code"]))
    git(checkout, "checkout", "--quiet", "HEAD")
    for (const path of paths) {
      assert.ok(existsSync(join(checkout, path)), `missing source: ${path}`)
      assert.ok(mayProduce("insecure-code", inventoryOf([path], "s")), path)
    }
    assert.ok(!existsSync(join(checkout, "docs/unrelated.txt")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
