/**
 * Split the corpus between machines. BENCH_SHARD="k/n" (1-based) keeps the
 * repos whose stable name hash falls in part k of n, so several machines can
 * each run resume.mjs / osv.mjs on their own part; the per-repo result files
 * are then copied together (they never overlap).
 */
import { createHash } from "node:crypto"

export function parseShard(spec = process.env.BENCH_SHARD) {
  if (!spec) return null
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim())
  if (!m || +m[1] < 1 || +m[1] > +m[2]) throw new Error(`BENCH_SHARD must look like "2/4", got "${spec}"`)
  return { k: +m[1], n: +m[2] }
}

export function shardOf(name, n) {
  return (createHash("sha1").update(name).digest().readUInt32BE(0) % n) + 1
}

export function inShard(repos, spec = process.env.BENCH_SHARD) {
  const s = parseShard(spec)
  return s ? repos.filter((r) => shardOf(r.name, s.n) === s.k) : repos
}
