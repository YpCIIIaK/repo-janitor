#!/usr/bin/env node
/**
 * Build recall cases from GitHub security advisories (OSV export).
 *
 *   node benchmark/recall-advisories.mjs <osv-dir> [--per 15] [--seed 20261116]
 *
 * <osv-dir> holds the unzipped OSV ecosystem exports (npm/, PyPI/, …) from
 * https://osv-vulnerabilities.storage.googleapis.com/<ecosystem>/all.zip.
 *
 * A usable advisory is a GHSA record with a CWE we map to a class and exactly one
 * fix-commit reference on GitHub. The case pairs that commit's parent (vulnerable)
 * with the commit (fixed); recall.mjs judges only the source files of the case's
 * language that the fix touched. Up to --per cases are drawn per language × class,
 * in a stable pseudo-random order, so reruns pick the same cases.
 *
 * Output: benchmark/recall/cases/advisories.json (private data).
 */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CWE_CLASS } from "./recall.mjs"

const here = dirname(fileURLToPath(import.meta.url))

export const ECOSYSTEM_LANGUAGE = { npm: "javascript", PyPI: "python", Packagist: "php", Go: "go", Maven: "java", RubyGems: "ruby" }
const FIX_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{40})$/

/** One advisory → a case, or null when it cannot be used. */
export function caseOf(adv, ecosystem) {
  if (!adv.id?.startsWith("GHSA-")) return null
  const cwes = (adv.database_specific?.cwe_ids ?? []).map((c) => Number(String(c).replace(/^CWE-/, "")))
  const cls = cwes.map((n) => CWE_CLASS[n]).find(Boolean)
  if (!cls) return null
  const fixes = [...new Set((adv.references ?? []).map((r) => FIX_RE.exec(r.url)).filter(Boolean).map((m) => `${m[1]}@${m[2]}`))]
  if (fixes.length !== 1) return null
  const [repo, sha] = fixes[0].split("@")
  return {
    id: adv.id,
    language: ECOSYSTEM_LANGUAGE[ecosystem],
    class: cls,
    cwe: cwes,
    source: { type: "git", url: `https://github.com/${repo}`, vulnerable: "parent", fixed: sha },
  }
}

export function pick(cases, per, seed) {
  const key = (c) => createHash("sha1").update(`${seed}:${c.id}`).digest("hex")
  const groups = new Map()
  for (const c of [...cases].sort((a, b) => key(a).localeCompare(key(b)))) {
    const g = `${c.language}|${c.class}`
    if (!groups.has(g)) groups.set(g, [])
    // One case per fixed commit: several advisories often share a fix.
    if (groups.get(g).length < per && !groups.get(g).some((x) => x.source.fixed === c.source.fixed)) groups.get(g).push(c)
  }
  return [...groups.values()].flat()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) throw new Error("usage: node benchmark/recall-advisories.mjs <osv-dir> [--per 15] [--seed N]")
  const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
  const per = Number(arg("per", 15))
  const seed = arg("seed", "20261116")
  const all = []
  for (const eco of Object.keys(ECOSYSTEM_LANGUAGE)) {
    let files
    try {
      files = readdirSync(join(dir, eco)).filter((f) => f.startsWith("GHSA-"))
    } catch {
      continue
    }
    for (const f of files) {
      const c = caseOf(JSON.parse(readFileSync(join(dir, eco, f), "utf8")), eco)
      if (c) all.push(c)
    }
  }
  const cases = pick(all, per, seed)
  mkdirSync(join(here, "recall", "cases"), { recursive: true })
  writeFileSync(join(here, "recall", "cases", "advisories.json"), JSON.stringify(cases, null, 1) + "\n")
  const by = {}
  for (const c of cases) by[c.language] = (by[c.language] ?? 0) + 1
  console.log(`${all.length} usable advisories → ${cases.length} cases`, by)
}
