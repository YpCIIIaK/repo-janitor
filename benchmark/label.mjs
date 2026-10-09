#!/usr/bin/env node
/**
 * Record verdicts: each stdin line is "<repo> <tp|fp> <finding id>".
 * Ids may contain spaces, so the id is everything after the verdict.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const input = readFileSync(0, "utf8")
const byRepo = new Map()
for (const raw of input.split("\n")) {
  const line = raw.trim()
  if (!line || line.startsWith("#")) continue
  const m = /^(\S+)\s+(tp|fp)\s+(.+)$/.exec(line)
  if (!m) throw new Error(`bad line: ${line}`)
  if (!byRepo.has(m[1])) byRepo.set(m[1], {})
  byRepo.get(m[1])[m[3]] = m[2]
}
for (const [repo, verdicts] of byRepo) {
  const path = join(here, "labels", `${repo}.json`)
  const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  const merged = { ...current, ...verdicts }
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]))
  writeFileSync(path, JSON.stringify(sorted, null, 1) + "\n")
  console.log(`${repo}: ${Object.keys(verdicts).length} labelled, ${Object.keys(sorted).length} total`)
}
