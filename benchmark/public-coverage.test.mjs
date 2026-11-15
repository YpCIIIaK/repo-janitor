import { test } from "node:test"
import assert from "node:assert/strict"
import { publicCoverage } from "./public-coverage.mjs"

test("mixed languages count once per pinned record; stale snapshots are excluded", () => {
  const corpus = [{ name: "mixed", sha: "a" }, { name: "alias", sha: "a" }, { name: "stale", sha: "b" }]
  const out = publicCoverage(corpus, (kind, name) => kind === "inventory"
    ? { sha: "a", exts: { ts: 3, tsx: 2, swift: 1, erl: 7 } }
    : { sha: "a", checkedAt: name === "mixed" ? "2026-11-01T00:00:00Z" : "2026-11-03T00:00:00Z" })
  assert.equal(out.records, 3)
  assert.equal(out.inventories, 2)
  assert.equal(out.metadataSnapshots, 2)
  assert.deepEqual(out.formats.find(row => row.name === "TypeScript"), { name: "TypeScript", records: 2, files: 10 })
  assert.equal(out.formats.find(row => row.name === "Erlang").files, 14)
  assert.equal(out.metadataOldestDay, "2026-11-01")
  assert.equal(out.metadataNewestDay, "2026-11-03")
})

test("transport audit, legacy metadata, missing data and provider limits stay distinct", () => {
  const corpus = ["audited", "legacy", "failed", "missing"].map(name => ({ name, sha: "a" }))
  const out = publicCoverage(corpus, (kind, name) => kind === "inventory" || name === "missing" ? null : {
    sha: "a", checkedAt: "not a date",
    ...(name === "legacy" ? {} : { networkAudit: { version: 2, transportOK: name === "audited", policyLimitedResponses: 1 } }),
  })
  assert.equal(out.metadataSnapshots, 3)
  assert.equal(out.auditedMetadataSnapshots, 1)
  assert.equal(out.legacyMetadataSnapshots, 1)
  assert.equal(out.policyLimitedMetadataSnapshots, 2)
  assert.equal(out.metadataOldestDay, null)
  assert.equal(out.inventories, 0)
  assert.deepEqual(out.formats, [])
})
