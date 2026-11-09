import { test } from "node:test"
import assert from "node:assert/strict"
import { TRACKS, inTrack, tracksOf } from "./tracks.mjs"

test("explicit tracks add to the derived ones", () => {
  const t = tracksOf({ name: "no-such-repo", url: "u", sha: "s", tracks: ["mobile"] })
  assert.ok(t.includes("mobile"))
  assert.ok(t.includes("general"))
})

test("vulnerable apps land in security, random-layer repos leave general", () => {
  assert.ok(tracksOf({ name: "owasp-nodegoat", url: "u", sha: "s" }).includes("security"))
  const r = tracksOf({ name: "x", url: "u", sha: "s", layer: "random" })
  assert.ok(r.includes("random"))
  assert.ok(!r.includes("general"))
})

test("every track declares a population, a purpose and a target", () => {
  for (const [id, t] of Object.entries(TRACKS)) assert.ok(t.population && t.purpose && t.labelsPerRule > 0, id)
  assert.throws(() => inTrack([], "nope"), /unknown track/)
})
