import { test } from "node:test"
import assert from "node:assert/strict"
import { inShard, parseShard } from "./shard.mjs"

test("shards partition the corpus without overlap", () => {
  const repos = Array.from({ length: 1000 }, (_, i) => ({ name: `repo-${i}` }))
  const parts = [1, 2, 3, 4].map((k) => inShard(repos, `${k}/4`).map((r) => r.name))
  assert.equal(parts.flat().length, 1000)
  assert.equal(new Set(parts.flat()).size, 1000)
  for (const p of parts) assert.ok(p.length > 200 && p.length < 300)
})

test("no shard keeps everything; bad specs are rejected", () => {
  assert.equal(inShard([{ name: "a" }], "").length, 1)
  assert.throws(() => parseShard("5/4"))
  assert.throws(() => parseShard("x"))
})
