import { test } from "node:test"
import assert from "node:assert/strict"
import { scannerFingerprints, scannerModules, staleScanners } from "./fingerprint.mjs"

const fps = { base: "b1", scanners: { a: "1", b: "2", c: "3" } }

test("a missing result or another commit needs a full scan", () => {
  assert.equal(staleScanners(null, "s", fps, "g"), null)
  assert.equal(staleScanners({ sha: "x", base: "b1", scanners: fps.scanners }, "s", fps, "g"), null)
})

test("a changed base needs a full scan", () => {
  assert.equal(staleScanners({ sha: "s", base: "b0", scanners: fps.scanners }, "s", fps, "g"), null)
})

test("only scanners whose fingerprint changed, plus new ones, rerun", () => {
  assert.deepEqual(staleScanners({ sha: "s", base: "b1", scanners: { a: "1", b: "9" } }, "s", fps, "g"), ["b", "c"])
  assert.deepEqual(staleScanners({ sha: "s", base: "b1", scanners: fps.scanners }, "s", fps, "g"), [])
})

test("results stamped only with the whole-code fingerprint are current when it matches", () => {
  assert.deepEqual(staleScanners({ sha: "s", fingerprint: "g" }, "s", fps, "g"), [])
  assert.equal(staleScanners({ sha: "s", fingerprint: "old" }, "s", fps, "g"), null)
})

test("every registered scanner gets a fingerprint", () => {
  const ids = Object.keys(scannerModules())
  assert.ok(ids.length >= 28)
  const { scanners } = scannerFingerprints()
  assert.deepEqual(Object.keys(scanners).sort(), ids.sort())
})
