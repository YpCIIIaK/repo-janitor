import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { installBaseline, validateArchivePaths, restoreBaseline } from "./local-rescan-restore.mjs"

test("baseline restoration accepts only benchmark data paths", () => {
  validateArchivePaths([".results/owner-repo.report.json", ".gitlog/owner-repo.json.gz", ".inventory/"])
  for (const path of ["../outside", "/etc/passwd", ".results/../../outside", ".results\\..\\outside", "packages/core/src/index.ts"]) {
    assert.throws(() => validateArchivePaths([path]), /Unexpected archive path/)
  }
})
test("baseline installation preserves existing snapshots and imports missing records separately", t => {
  const root = mkdtempSync(join(tmpdir(), "janitor-baseline-"))
  t.after(() => rmSync(root, { recursive: true }))
  for (const directory of ["staging/.results", "baseline/.results"]) mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, "staging/.results/old.json"), "replacement")
  writeFileSync(join(root, "staging/.results/new.json"), "new")
  writeFileSync(join(root, "baseline/.results/old.json"), "preserved")
  assert.equal(installBaseline(join(root, "staging"), join(root, "baseline")), 1)
  assert.equal(readFileSync(join(root, "baseline/.results/old.json"), "utf8"), "preserved")
  assert.equal(readFileSync(join(root, "baseline/.results/new.json"), "utf8"), "new")
})

test("verified Git archive restoration works without overwriting published results", t => {
  const temporary = mkdtempSync(join(tmpdir(), "janitor-restore-git-"))
  t.after(() => rmSync(temporary, { recursive: true }))
  const remote = join(temporary, "data"), root = join(temporary, "source"), payload = join(temporary, "payload")
  for (const directory of [remote, root, join(payload, ".results"), join(root, "benchmark/.results")]) mkdirSync(directory, { recursive: true })
  const run = (cmd, args) => {
    const result = spawnSync(cmd, args, { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
  }
  writeFileSync(join(payload, ".results/fixture-one.json"), '{"sha":"archived"}')
  writeFileSync(join(root, "benchmark/.results/fixture-one.json"), '{"sha":"published"}')
  run("tar", ["-czf", join(remote, "chunk-000.tar.gz"), "-C", payload, ".results/fixture-one.json"])
  const checksum = createHash("sha256").update(readFileSync(join(remote, "chunk-000.tar.gz"))).digest("hex")
  writeFileSync(join(remote, "manifest.json"), JSON.stringify({ chunks: { "chunk-000": ["fixture-one"] } }))
  writeFileSync(join(remote, "checksums.sha256"), `${checksum}  chunk-000.tar.gz\n`)
  run("git", ["init", "--quiet", "--initial-branch=bench-data-test", remote])
  run("git", ["-C", remote, "add", "."])
  run("git", ["-C", remote, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "Verified fixture"])
  run("git", ["init", "--quiet", root]); run("git", ["-C", root, "remote", "add", "origin", remote])
  const restored = restoreBaseline(root, "bench-data-test")
  assert.equal(restored.installed, 1)
  assert.equal(readFileSync(join(root, "benchmark/.results/fixture-one.json"), "utf8"), '{"sha":"published"}')
  assert.equal(readFileSync(join(restored.baseline, ".results/fixture-one.json"), "utf8"), '{"sha":"archived"}')
  assert.equal(JSON.parse(readFileSync(join(restored.baseline, "snapshot.json"), "utf8")).status, "complete")
  assert.equal(restoreBaseline(root, "bench-data-test").installed, 0)
  writeFileSync(join(remote, "checksums.sha256"), `${"0".repeat(64)}  chunk-000.tar.gz\n`)
  run("git", ["-C", remote, "add", "."])
  run("git", ["-C", remote, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "Corrupted checksum fixture"])
  const badRoot = join(temporary, "bad-source")
  mkdirSync(badRoot)
  run("git", ["init", "--quiet", badRoot]); run("git", ["-C", badRoot, "remote", "add", "origin", remote])
  assert.throws(() => restoreBaseline(badRoot, "bench-data-test"), /Checksum mismatch/)
  assert.equal(existsSync(join(badRoot, "benchmark/.local-rescans/baseline/.results/fixture-one.json")), false)
  assert.equal(existsSync(join(badRoot, "benchmark/.local-rescans/active.lock")), false)
})
