#!/usr/bin/env node
/**
 * Recall: how many known vulnerabilities does a scanner engine find?
 *
 *   node benchmark/recall.mjs [--engine fast[,deep]] [--cases dir] [--out file]
 *
 * A case is a vulnerable/fixed pair of the same code. The fix tells us where the
 * vulnerability was: the files it changed. A case counts as
 *   hit   — the vulnerable version has more findings of the case's class in a
 *           changed file than the fixed version (the fix removed what we flagged);
 *   near  — we flag that class in a changed file, but the fix did not reduce it
 *           (typical for access control: the fix adds a check elsewhere);
 *   miss  — no finding of that class in any changed file.
 * recall = hit / cases. `near` is reported but never counted as found.
 *
 * Case files (JSON arrays) live in benchmark/recall/cases/ (private data) or are
 * passed with --cases. One case:
 *   {
 *     "id": "CVE-2024-1234",
 *     "language": "php",
 *     "class": "sqli",                         // see CLASSES below
 *     "source": { "type": "git", "url": "https://github.com/<owner>/<repo>", "vulnerable": "<sha>", "fixed": "<sha>" }
 *        |     { "type": "dir", "vulnerable": "rel/path", "fixed": "rel/path" },
 *     "files": ["src/a.php"]                    // optional: overrides the diff
 *   }
 * or a single version with a known answer per file (training apps):
 *   { "id": "dvwa-sqli-low", "language": "php", "class": "sqli", "expect": "vulnerable" | "clean",
 *     "source": { "type": "git", "url": "…", "tree": "<sha>" }, "files": ["vulnerabilities/sqli/source/low.php"] }
 *
 * Engines map a directory to findings { rule, file, line }. `fast` is the normal
 * repo-janitor CLI with low-confidence findings included; further engines (the
 * per-language deep analysers) register in ENGINES.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const cacheDir = join(here, ".recall-cache")

/** Vulnerability classes, keyed to the rule ids that report them. */
export const CLASSES = {
  sqli: /sql/,
  xss: /xss|innerhtml|dangerous-html|template-html/,
  cmdi: /exec-interpolated|shell-true|os-system|command/,
  "code-injection": /eval|new-function|include-user-input|code-injection/,
  deserialization: /unserialize|deserializ|pickle|marshal|yaml-load/,
  ssrf: /ssrf/,
  "path-traversal": /path-traversal|path-injection/,
  xxe: /xxe/,
  "open-redirect": /redirect/,
  tls: /tls/,
  crypto: /weak-hash|random-for-secret|weak-cipher/,
  secrets: /^secret-/,
  // No rule targets these yet. They stay in the table so the gap shows as 0%.
  csrf: /csrf/,
  "access-control": /idor|access-control|missing-auth|capability/,
  "file-upload": /upload/,
  auth: /weak-session|brute|hardcoded-cred|auth-bypass/,
  "input-validation": /input-validation|mass-assign/,
  "data-exposure": /exposure|sensitive-file|debug-endpoint/,
  misconfig: /misconfig|cors|debug-mode/,
  "client-logic": /client-logic/,
}

export function classOf(rule) {
  return Object.keys(CLASSES).find((c) => CLASSES[c].test(rule)) ?? null
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || "").slice(0, 400)}`)
  return r.stdout
}

// --- engines ------------------------------------------------------------------

function fastEngine(dir) {
  const out = join(mkdtempSync(join(tmpdir(), "recall-")), "r.json")
  spawnSync(process.execPath, [join(root, "packages/cli/dist/index.js"), "scan", dir, "-f", "json", "--all", "-o", out], { stdio: "ignore" })
  if (!existsSync(out)) throw new Error(`fast engine produced no report for ${dir}`)
  const r = JSON.parse(readFileSync(out, "utf8"))
  rmSync(dirname(out), { recursive: true, force: true })
  return [...(r.issues ?? []), ...(r.lowConfidence ?? [])].map((i) => {
    const m = /^(.*?):(\d+)/.exec(i.location ?? "")
    return { rule: i.rule ?? "", id: i.id, file: m ? m[1] : (i.location ?? ""), line: m ? +m[2] : 0 }
  })
}

export const ENGINES = { fast: fastEngine }

// --- cases --------------------------------------------------------------------

/** Rule id of a finding: explicit `rule`, else the id prefix before the location. */
function ruleOf(f) {
  if (f.rule) return f.rule
  const loc = f.file ? f.id.indexOf(`-${f.file}`) : -1
  return loc > 0 ? f.id.slice(0, loc) : f.id
}

/** One shallow checkout per (url, sha), shared by every case that uses it. */
function gitTree(url, sha) {
  const d = join(cacheDir, `${url.replace(/^https?:\/\//, "").replace(/[^\w.-]/g, "_")}@${sha.slice(0, 12)}`)
  if (!existsSync(join(d, ".git"))) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
    sh("git", ["-C", d, "init", "-q"])
    sh("git", ["-C", d, "fetch", "-q", "--depth", "1", url, sha])
    sh("git", ["-C", d, "checkout", "-q", "FETCH_HEAD"])
  }
  return d
}

function tree(c, side) {
  const s = c.source
  if (s.type === "dir") return resolve(c._base, s[side])
  if (s.type === "git") return gitTree(s.url, s[side])
  throw new Error(`${c.id}: unknown source type ${s.type}`)
}

/** Scan each (engine, directory) once per run. */
const scanned = new Map()
function scan(engine, dir) {
  const key = `${engine}|${dir}`
  if (!scanned.has(key)) scanned.set(key, ENGINES[engine](dir))
  return scanned.get(key)
}

/** Files that differ between the two versions (relative paths). */
function changedFiles(a, b) {
  const r = spawnSync("git", ["diff", "--no-index", "--name-only", "--", a, b], { encoding: "utf8", maxBuffer: 1 << 26 })
  const rel = new Set()
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    for (const base of [a, b]) {
      const abs = resolve(line)
      if (abs.startsWith(base + "/")) rel.add(relative(base, abs))
    }
  }
  return [...rel].filter((f) => !f.startsWith(".git/"))
}

export function judge(c, vulnFindings, fixedFindings, files) {
  const inScope = (f) => files.includes(f.file) && classOf(ruleOf(f)) === c.class
  const v = vulnFindings.filter(inScope)
  const x = fixedFindings.filter(inScope)
  const count = (list) => list.reduce((m, f) => m.set(f.file, (m.get(f.file) ?? 0) + 1), new Map())
  const cv = count(v), cx = count(x)
  for (const [file, n] of cv) if (n > (cx.get(file) ?? 0)) return { verdict: "hit", file }
  return { verdict: v.length ? "near" : "miss" }
}

/**
 * Single-version case: `expect` says whether the listed files contain the
 * vulnerability. vulnerable → hit / miss; clean → clean / fp (a false alarm on
 * code known to be fixed, e.g. DVWA's "impossible" level).
 */
export function judgeExpected(c, findings) {
  const found = findings.find((f) => c.files.includes(f.file) && classOf(ruleOf(f)) === c.class)
  if (c.expect === "clean") return { verdict: found ? "fp" : "clean", file: found?.file }
  return found ? { verdict: "hit", file: found.file } : { verdict: "miss" }
}

export function loadCases(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) =>
    JSON.parse(readFileSync(join(dir, f), "utf8")).map((c) => ({ ...c, _base: dir, _set: f.replace(/\.json$/, "") })),
  )
}

export function summarise(results) {
  const rows = new Map()
  for (const r of results) {
    const key = `${r.engine}|${r.language}|${r.class}`
    const row = rows.get(key) ?? { engine: r.engine, language: r.language, class: r.class, cases: 0, hit: 0, near: 0, miss: 0, error: 0, clean: 0, fp: 0 }
    row.cases++
    row[r.verdict]++
    rows.set(key, row)
  }
  return [...rows.values()]
    .map((r) => {
      // Recall counts only cases that contain the vulnerability; clean controls feed fp.
      const vulnerable = r.hit + r.near + r.miss
      return { ...r, recall: vulnerable ? Number((r.hit / vulnerable).toFixed(3)) : null }
    })
    .sort((a, b) => a.language.localeCompare(b.language) || a.class.localeCompare(b.class) || a.engine.localeCompare(b.engine))
}

export function run(cases, engines) {
  const results = []
  for (const c of cases) {
    if (!CLASSES[c.class]) throw new Error(`${c.id}: unknown class "${c.class}"`)
    const base = { id: c.id, set: c._set, language: c.language, class: c.class }
    for (const engine of engines) {
      try {
        if (c.expect) {
          if (!c.files?.length) throw new Error("expect cases need files")
          results.push({ ...base, engine, ...judgeExpected(c, scan(engine, tree(c, "tree"))) })
        } else {
          const v = tree(c, "vulnerable"), x = tree(c, "fixed")
          const files = c.files ?? changedFiles(v, x)
          results.push({ ...base, engine, ...judge(c, scan(engine, v), scan(engine, x), files) })
        }
      } catch (e) {
        results.push({ ...base, engine, verdict: "error", error: String(e.message).slice(0, 200) })
      }
    }
  }
  return results
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : dflt
  }
  const engines = arg("engine", "fast").split(",")
  for (const e of engines) if (!ENGINES[e]) throw new Error(`unknown engine "${e}" (have: ${Object.keys(ENGINES).join(", ")})`)
  const cases = loadCases(resolve(arg("cases", join(here, "recall", "cases"))))
  if (!cases.length) {
    console.log("no recall cases found (private data: node benchmark/private.mjs pull)")
    process.exit(0)
  }
  const results = run(cases, engines)
  const summary = summarise(results)
  const out = resolve(arg("out", join(here, "recall-report.json")))
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), engines, cases: cases.length, summary, results }, null, 1) + "\n")
  console.log("| engine | language | class | cases | hit | near | miss | recall | clean | fp | error |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
  for (const r of summary)
    console.log(`| ${r.engine} | ${r.language} | ${r.class} | ${r.cases} | ${r.hit} | ${r.near} | ${r.miss} | ${r.recall == null ? "—" : `${Math.round(r.recall * 100)}%`} | ${r.clean} | ${r.fp} | ${r.error} |`)
  console.log(`\n${results.filter((r) => r.verdict === "error").length} errors · report: ${relative(root, out)}`)
}
