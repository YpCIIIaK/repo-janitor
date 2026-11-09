#!/usr/bin/env node
/**
 * Reapply the current confidence scale to stored findings and recompute every
 * report's score and grade — no clone, no scan. Run after `score.mjs --update`
 * changes packages/core/src/confidence-data.ts (and the core is rebuilt).
 *
 *   pnpm --filter ./packages/core build && node benchmark/rescore.mjs
 *
 * Findings whose confidence the scanner set itself (insecure-code: taint-gated)
 * keep it; every other finding takes the per-rule confidence, as runScan does.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const coreDist = join(here, "..", "packages", "core", "dist", "index.js")
const data = join(here, "..", "packages", "core", "src", "confidence-data.ts")
if (!existsSync(coreDist) || statSync(coreDist).mtimeMs < statSync(data).mtimeMs) {
  console.error("Core build is older than confidence-data.ts: pnpm --filter ./packages/core build")
  process.exit(1)
}
const { computeScore, confidenceOf, scoreToGrade } = await import(pathToFileURL(coreDist).href)
const SELF_STAMPED = new Set(["insecure-code"])
const conf = (f) => (SELF_STAMPED.has(f.scanner) ? f.confidence : confidenceOf(f.rule))

const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))
let changedScores = 0
let changedConfidence = 0
for (const repo of corpus) {
  const reportPath = join(here, ".results", `${repo.name}.report.json`)
  const resultPath = join(here, ".results", `${repo.name}.json`)
  if (!existsSync(reportPath) || !existsSync(resultPath)) continue
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  const all = [...(report.issues ?? []), ...(report.lowConfidence ?? [])].map((f) => {
    const c = conf(f)
    if (c !== f.confidence) changedConfidence++
    return { ...f, confidence: c }
  })
  const confident = all.filter((f) => f.confidence !== "low")
  const low = all.filter((f) => f.confidence === "low")
  const score = computeScore(confident, report.config?.weights)
  if (score !== report.score) changedScores++
  const next = { ...report, score, grade: scoreToGrade(score), issues: confident }
  if (low.length) next.lowConfidence = low
  else delete next.lowConfidence
  writeFileSync(reportPath, JSON.stringify(next))

  const result = JSON.parse(readFileSync(resultPath, "utf8"))
  result.findings = result.findings.map((f) => ({ ...f, confidence: conf(f) }))
  writeFileSync(resultPath, JSON.stringify(result, null, 1))

  // The online pass omits rule names in older snapshots. Keep its confidence
  // consistent with the offline reports after calibration too.
  const onlinePath = join(here, ".results", `${repo.name}.osv.json`)
  if (existsSync(onlinePath)) {
    const online = JSON.parse(readFileSync(onlinePath, "utf8"))
    online.findings = online.findings.map((f) => {
      const rule = f.rule ?? (f.id.startsWith("license-") ? "license-" + f.id.split("-")[1] : "vuln")
      const confidence = confidenceOf(rule)
      if (confidence !== f.confidence) changedConfidence++
      return { ...f, confidence }
    })
    writeFileSync(onlinePath, JSON.stringify(online))
  }
}
console.log(`rescored ${corpus.length} repos: ${changedConfidence} confidences and ${changedScores} scores changed`)
