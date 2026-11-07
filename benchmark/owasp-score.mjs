#!/usr/bin/env node
/** Evaluate external OWASP BenchmarkJava truth data; never writes labels. */
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

// These are Java rules actually supported by this scanner, not every CWE that
// a similarly named rule in another language can detect.
export const JAVA_RULE_CWE = { "sql-interpolated": 89, "exec-interpolated": 78, "java-deserialization": 502 }

export function parseExpected(csv) {
  const seen = new Set()
  return csv.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return []
    const fields = line.split(",").map(s => s.trim().replace(/^"(.*)"$/, "$1"))
    const [name, category, answer, cwe] = fields
    if (!/^BenchmarkTest\d+$/.test(name) || !/^(true|false)$/i.test(answer) || !/^\d+$/.test(cwe ?? "")) throw new Error(`Invalid truth row ${index + 1}`)
    if (seen.has(name)) throw new Error(`Duplicate truth case ${name}`)
    seen.add(name)
    return [{ name, category, vulnerable: answer.toLowerCase() === "true", cwe: Number(cwe) }]
  })
}

export function evaluate(expected, report, availableCases, { confidence = "all", totalCap = 60, fileCap = 6 } = {}) {
  if (!["all", "visible"].includes(confidence)) throw new Error("confidence must be all or visible")
  if (!Array.isArray(report.findings) && !Array.isArray(report.issues)) throw new Error("Expected findings array or CLI report issues")
  const findings = report.findings ?? [...(report.issues ?? []), ...(report.lowConfidence ?? [])]
  if (!Array.isArray(findings)) throw new Error("Expected findings array or CLI report")
  const available = new Set(availableCases), supported = new Set(Object.values(JAVA_RULE_CWE))
  const security = findings.filter(f => f.scanner === "insecure-code" || f.id?.startsWith("insecure-"))
  const fileCounts = new Map(), detected = new Set(), unmatched = []
  for (const f of security) {
    const location = String(f.location ?? "").replace(/\\/g, "/")
    const file = location.replace(/:\d+$/, "")
    fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1)
    // Benchmark slim results use taxonomy IDs (insecure-*); raw scanner/CLI
    // issues may carry only the finding ID. Match known rule prefixes exactly.
    const explicitRule = typeof f.rule === "string" ? f.rule.replace(/^insecure-/, "") : null
    const rule = explicitRule && JAVA_RULE_CWE[explicitRule] ? explicitRule :
      Object.keys(JAVA_RULE_CWE).find(key => f.id?.startsWith(`insecure-${key}-`))
    const cwe = JAVA_RULE_CWE[rule]
    if (!cwe || confidence === "visible" && f.confidence === "low") continue
    const name = /(?:^|\/)(BenchmarkTest\d+)\.java(?::\d+)?$/.exec(location)?.[1]
    if (!name) { unmatched.push(f.id); continue }
    detected.add(`${name}:${cwe}`)
  }
  const cappedFiles = [...fileCounts].filter(([, n]) => n >= fileCap).map(([f]) => f)
  const globalCapSuspected = security.length >= totalCap
  const scannerFailures = report.diagnostics?.failedScanners ?? []
  const byCwe = {}, missingCases = [], unsupported = {}, cases = []
  for (const row of expected) {
    if (!supported.has(row.cwe)) { unsupported[row.cwe] = (unsupported[row.cwe] ?? 0) + 1; continue }
    if (!available.has(row.name)) { missingCases.push(row.name); continue }
    const positive = detected.has(`${row.name}:${row.cwe}`)
    const outcome = row.vulnerable ? positive ? "tp" : "fn" : positive ? "fp" : "tn"
    const counts = byCwe[row.cwe] ??= { tp: 0, fp: 0, fn: 0, tn: 0 }
    counts[outcome]++
    cases.push({ name: row.name, cwe: row.cwe, outcome })
  }
  const totals = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const counts of Object.values(byCwe)) for (const key of Object.keys(totals)) totals[key] += counts[key]
  return {
    confidence, supportedCwes: [...supported].sort((a, b) => a - b), totals, byCwe,
    coverage: { expected: expected.length, evaluated: cases.length, missingCases, unsupportedCwes: unsupported },
    limitations: {
      globalCapSuspected, cappedFiles, scannerFailures, analysisCompleteness: "not-proven", capThresholds: { total: totalCap, perFile: fileCap },
      negativeCasesReliable: !globalCapSuspected && !cappedFiles.length && !missingCases.length && !scannerFailures.length,
      note: "FN/TN describe absent findings, not proof of completed analysis. Caps are inferred from emitted finding counts; scanner file filters, failures and unsupported flows can also reduce coverage. Missing source cases are excluded from confusion counts.",
    }, unmatchedFindings: unmatched, cases,
  }
}

function sourceCases(root) {
  const names = []
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /^BenchmarkTest\d+\.java$/.test(entry.name)) names.push(basename(entry.name, ".java"))
    }
  }
  visit(root)
  return names
}

function main(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--checkout", "--results", "--expected", "--confidence"].includes(argv[i]) || !argv[i + 1]) throw new Error("Usage: node benchmark/owasp-score.mjs --checkout <external-clone> --results <report.json> [--expected <csv>] [--confidence all|visible]")
    options[argv[i].slice(2)] = argv[i + 1]
  }
  if (!options.checkout || !options.results) throw new Error("--checkout and --results are required")
  const checkout = resolve(options.checkout)
  const candidates = readdirSync(checkout).filter(f => /^expectedresults-.*\.csv$/.test(f))
  if (!options.expected && candidates.length !== 1) throw new Error("Select --expected explicitly: checkout must contain exactly one expectedresults-*.csv")
  const expectedPath = options.expected ? resolve(options.expected) : join(checkout, candidates[0])
  const report = JSON.parse(readFileSync(options.results, "utf8"))
  const output = evaluate(parseExpected(readFileSync(expectedPath, "utf8")), report, sourceCases(checkout), { confidence: options.confidence ?? "all" })
  const checkoutSha = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const resultsSha = report.sha ?? report.repo?.commit ?? null
  output.provenance = { checkoutSha, resultsSha, sameCommit: resultsSha === checkoutSha, expectedFile: basename(expectedPath) }
  if (resultsSha !== checkoutSha) output.limitations.negativeCasesReliable = false
  console.log(JSON.stringify(output, null, 2))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
