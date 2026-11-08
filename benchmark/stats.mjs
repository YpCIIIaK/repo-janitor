#!/usr/bin/env node
/**
 * What the benchmark corpus says about open-source repositories in general.
 *
 *   node benchmark/stats.mjs     → benchmark/STATS.md + benchmark/stats.json
 *
 * Reads the full reports `run.mjs` saves (.results/<repo>.report.json). Only
 * confident findings count (high + medium, as a user sees them); low-confidence
 * ones are noise by measurement and would skew every number here.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, ".results")
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))

const repos = []
for (const r of corpus) {
  const p = join(resultsDir, `${r.name}.report.json`)
  if (!existsSync(p)) continue
  const rep = JSON.parse(readFileSync(p, "utf8"))
  const langs = rep.profile?.languages ?? []
  const loc = rep.metrics?.linesOfCode ?? langs.reduce((s, l) => s + (l.loc ?? 0), 0)
  repos.push({
    name: r.name,
    url: r.url,
    score: rep.score,
    grade: rep.grade,
    loc,
    language: langs[0]?.language ?? "other",
    tools: rep.profile?.tools ?? [],
    checklist: rep.profile?.checklist ?? {},
    activity: rep.profile?.activity ?? {},
    issues: rep.issues ?? [],
    hidden: rep.lowConfidence?.length ?? 0,
    low: rep.lowConfidence ?? [],
    langs,
  })
}

const VULNERABLE_RE = /veracode-research-actuator-testbed|terracotta-bank-terracotta-bank|owasp-benchmark-benchmarkjava|goat|dvwa|dvna|dvws|juice-shop$|juice-shop-juice-shop|vampi|dsvw|vulnerable|crapi|govwa|pygoat|vulpy|dvpwa|goof|inject-some-sql|vulnado|javavulnerablelab|dvsa/i
const urlByName = new Map(corpus.map((r) => [r.name, r.url.replace("https://github.com/", "")]))
const urlOf = (name) => urlByName.get(name) ?? name

/** Labelled precision per confidence level, from benchmark/labels and the latest results. */
function precisionByConfidence() {
  const out = { high: { tp: 0, fp: 0 }, medium: { tp: 0, fp: 0 }, low: { tp: 0, fp: 0 } }
  for (const r of corpus) {
    const lp = join(here, "labels", `${r.name}.json`)
    const rp = join(resultsDir, `${r.name}.json`)
    if (!existsSync(lp) || !existsSync(rp)) continue
    const labels = JSON.parse(readFileSync(lp, "utf8"))
    for (const f of JSON.parse(readFileSync(rp, "utf8")).findings ?? []) {
      const v = labels[f.id]
      const c = out[f.confidence ?? "medium"]
      if (!c || (v !== "tp" && v !== "fp")) continue
      c[v]++
    }
  }
  return out
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—")
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const has = (r, rule) => r.issues.some((i) => i.rule === rule)
const count = (r, rule) => r.issues.filter((i) => i.rule === rule).length
const n = repos.length
const out = []
const json = { repos: n, generatedAt: new Date().toISOString() }

out.push(`# What ${n} open-source repos look like`, "")
out.push(
  `${n} public repositories, scanned offline at pinned commits by repo-janitor. Only findings ` +
    "a user sees by default (high + medium confidence) are counted.",
  "",
)

// --- grades -----------------------------------------------------------------
const grades = ["A", "B", "C", "D", "F"].map((g) => [g, repos.filter((r) => r.grade === g).length])
out.push("## Grades", "", "| grade | repos | share |", "|---|---:|---:|")
for (const [g, c] of grades) out.push(`| ${g} | ${c} | ${pct(c, n)} |`)
out.push("", `Median score **${median(repos.map((r) => r.score))}**.`, "")
json.grades = Object.fromEntries(grades)

// --- by language ------------------------------------------------------------
const byLang = new Map()
for (const r of repos) {
  const l = byLang.get(r.language) ?? []
  l.push(r)
  byLang.set(r.language, l)
}
out.push("## By main language", "", "| language | repos | median score | findings / 1k lines |", "|---|---:|---:|---:|")
const langRows = [...byLang.entries()].filter(([, l]) => l.length >= 5).sort((a, b) => b[1].length - a[1].length)
json.languages = {}
for (const [lang, l] of langRows) {
  const density = median(l.filter((r) => r.loc > 500).map((r) => (1000 * r.issues.length) / r.loc))
  out.push(`| ${lang} | ${l.length} | ${median(l.map((r) => r.score))} | ${density.toFixed(1)} |`)
  json.languages[lang] = { repos: l.length, medianScore: median(l.map((r) => r.score)), findingsPer1k: Number(density.toFixed(2)) }
}
out.push("")

// --- how common each problem is ---------------------------------------------
const ruleRepos = new Map()
for (const r of repos) for (const rule of new Set(r.issues.map((i) => i.rule))) ruleRepos.set(rule, (ruleRepos.get(rule) ?? 0) + 1)
out.push("## How common each problem is", "", "Share of repos with at least one finding of the rule.", "")
out.push("| rule | repos | share |", "|---|---:|---:|")
const ruleRows = [...ruleRepos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
for (const [rule, c] of ruleRows) out.push(`| ${rule} | ${c} | ${pct(c, n)} |`)
out.push("")
json.ruleShare = Object.fromEntries(ruleRows.map(([k, c]) => [k, Number((c / n).toFixed(3))]))

// --- supply chain -------------------------------------------------------------
const withActions = repos.filter((r) => r.tools.includes("GitHub Actions"))
const unpinned = withActions.filter((r) => has(r, "workflow-action-tag") || has(r, "workflow-action-tag-first-party"))
const thirdParty = withActions.filter((r) => has(r, "workflow-action-tag"))
const noPerms = withActions.filter((r) => has(r, "workflow-no-permissions"))
out.push("## CI supply chain", "")
out.push(`- **${pct(unpinned.length, withActions.length)}** of ${withActions.length} repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.`)
out.push(`- **${pct(thirdParty.length, withActions.length)}** do it for a *third-party* action — the tj-actions/changed-files attack vector.`)
out.push(`- **${pct(noPerms.length, withActions.length)}** have a workflow that never restricts its token permissions.`)
out.push(`- Median unpinned actions per repo: **${median(unpinned.map((r) => count(r, "workflow-action-tag") + count(r, "workflow-action-tag-first-party")))}**.`, "")
json.ci = { withActions: withActions.length, unpinned: unpinned.length, thirdPartyUnpinned: thirdParty.length, noPermissions: noPerms.length }

// --- runtimes -----------------------------------------------------------------
const node = repos.filter((r) => r.tools.includes("Node.js"))
const py = repos.filter((r) => r.tools.includes("Python") || r.language === "Python")
out.push("## End-of-life runtimes", "")
out.push(`- **${pct(node.filter((r) => has(r, "eol-node")).length, node.length)}** of ${node.length} Node.js projects still declare or test on an end-of-life Node version.`)
out.push(`- **${pct(py.filter((r) => has(r, "eol-python")).length, py.length)}** of ${py.length} Python projects still support an end-of-life Python.`)
out.push(`- **${pct(repos.filter((r) => has(r, "eol-runner")).length, n)}** of all repos run CI on a retired runner image.`, "")
json.eol = {
  node: { repos: node.length, eol: node.filter((r) => has(r, "eol-node")).length },
  python: { repos: py.length, eol: py.filter((r) => has(r, "eol-python")).length },
}

// --- hygiene checklist ----------------------------------------------------------
const items = ["readme", "license", "contributing", "security", "codeOfConduct", "changelog", "ci", "tests"]
out.push("## Project hygiene", "", "| has | share |", "|---|---:|")
json.checklist = {}
for (const k of items) {
  const c = repos.filter((r) => r.checklist[k]).length
  out.push(`| ${k} | ${pct(c, n)} |`)
  json.checklist[k] = Number((c / n).toFixed(3))
}
out.push("")

// --- age of debt ------------------------------------------------------------------
const todoAges = repos.flatMap((r) => r.issues.filter((i) => i.rule === "todo" && i.ageDays > 0).map((i) => i.ageDays))
const oldest = repos
  .flatMap((r) => r.issues.filter((i) => i.rule === "todo").map((i) => ({ repo: r.name, i })))
  .sort((a, b) => b.i.ageDays - a.i.ageDays)
  .slice(0, 5)
out.push("## How old the debt is", "")
out.push(`- Median age of a TODO/FIXME: **${(median(todoAges) / 365).toFixed(1)} years** (${todoAges.length} dated).`)
out.push(`- ${pct(todoAges.filter((d) => d > 5 * 365).length, todoAges.length)} of them are older than five years.`)
out.push("", "Oldest TODOs in the corpus:", "")
for (const { repo, i } of oldest) out.push(`- ${(i.ageDays / 365).toFixed(1)} y — ${repo} \`${i.location}\``)
out.push("")
json.todo = {
  dated: todoAges.length,
  medianDays: median(todoAges),
  overFiveYears: todoAges.filter((d) => d > 5 * 365).length,
  oldest: oldest.map(({ repo, i }) => ({ repo: urlOf(repo), location: i.location, years: Number((i.ageDays / 365).toFixed(1)) })),
}

// --- activity vs health -----------------------------------------------------------------
const active = repos.filter((r) => (r.activity.commitsLastYear ?? 0) >= 50)
const quiet = repos.filter((r) => (r.activity.commitsLastYear ?? 0) < 10)
out.push("## Does activity mean health?", "")
out.push(`- Active repos (≥ 50 commits last year, ${active.length}): median score **${median(active.map((r) => r.score))}**.`)
out.push(`- Quiet repos (< 10 commits, ${quiet.length}): median score **${median(quiet.map((r) => r.score))}**.`)
out.push(`- Mean findings per repo: active ${mean(active.map((r) => r.issues.length)).toFixed(0)}, quiet ${mean(quiet.map((r) => r.issues.length)).toFixed(0)}.`, "")
json.activity = { active: active.length, activeMedian: median(active.map((r) => r.score)), quiet: quiet.length, quietMedian: median(quiet.map((r) => r.score)) }

// --- size --------------------------------------------------------------------------------
const buckets = [
  ["< 5k lines", 0, 5e3],
  ["5k–50k", 5e3, 5e4],
  ["50k–200k", 5e4, 2e5],
  ["> 200k", 2e5, Infinity],
]
out.push("## Size vs score", "", "| size | repos | median score |", "|---|---:|---:|")
json.sizeBands = []
for (const [label, a, b] of buckets) {
  const l = repos.filter((r) => r.loc >= a && r.loc < b)
  out.push(`| ${label} | ${l.length} | ${median(l.map((r) => r.score))} |`)
  json.sizeBands.push({ label, repos: l.length, medianScore: median(l.map((r) => r.score)) })
}
out.push("")

// --- leaderboards ---------------------------------------------------------------------------
const best = [...repos].sort((a, b) => b.score - a.score || a.issues.length - b.issues.length).slice(0, 10)
const worst = [...repos].sort((a, b) => a.score - b.score).slice(0, 10)
out.push("## Cleanest repos", "")
for (const r of best) out.push(`- **${r.score}** ${r.name} (${r.issues.length} findings)`)
out.push("", "## Most to clean up", "")
for (const r of worst) out.push(`- **${r.score}** ${r.name} (${r.issues.length} findings)`)
out.push("")
json.best = best.map((r) => ({ repo: urlOf(r.name), score: r.score, findings: r.issues.length }))
json.worst = [...repos]
  .filter((r) => !VULNERABLE_RE.test(r.name))
  .sort((a, b) => a.score - b.score || b.issues.length - a.issues.length)
  .slice(0, 8)
  .map((r) => ({ repo: urlOf(r.name), score: r.score, findings: r.issues.length }))
json.medianScore = median(repos.map((r) => r.score))

// --- deliberately vulnerable apps: what the scanner finds where holes are known -----------
json.vulnerableApps = repos
  .filter((r) => VULNERABLE_RE.test(r.name))
  .map((r) => {
    const high = r.issues.filter((i) => /^(?:insecure|iac|secret)-/.test(i.id) && i.confidence === "high")
    return { repo: urlOf(r.name), language: r.language, high: high.length, crossFile: high.filter((i) => /Request input reaches/.test(i.detail ?? "")).length }
  })
  .sort((a, b) => b.high - a.high)

// --- practices vs health ------------------------------------------------------------------
// Bigger repos score lower whatever they do, and bigger repos also adopt more
// practices — so a raw comparison would credit Dependabot with the effect of
// size. Compare inside size bands and average the gaps, weighted by band size.
// Health is measured two ways: the score, and findings per 1k lines (density),
// which does not punish size at all.
const histDir = join(here, ".history")
const BANDS = [[0, 5e3], [5e3, 5e4], [5e4, 2e5], [2e5, Infinity]]
const PRACTICE_LABELS = {
  dependabot: "Dependabot", renovate: "Renovate", security: "SECURITY.md", codeowners: "CODEOWNERS",
  codeql: "CodeQL", scorecard: "OpenSSF Scorecard", preCommit: "pre-commit", issueTemplates: "Issue templates",
  prTemplate: "PR template", contributing: "CONTRIBUTING", changeset: "Changesets", devcontainer: "Dev container",
  editorconfig: ".editorconfig", tsconfig: "TypeScript", eslintFlat: "ESLint flat config", prettier: "Prettier",
}
const hist = new Map()
for (const r of repos) {
  const p = join(histDir, `${r.name}.json`)
  // A history file cut short by a killed run is skipped, not fatal.
  if (existsSync(p)) try { hist.set(r.name, JSON.parse(readFileSync(p, "utf8"))) } catch { /* rebuilt on the next run */ }
}
const density = (r) => (r.loc > 500 ? (1000 * r.issues.length) / r.loc : null)
function controlled(metric, withP) {
  let gap = 0
  let weight = 0
  for (const [a, b] of BANDS) {
    const band = repos.filter((r) => hist.has(r.name) && r.loc >= a && r.loc < b && metric(r) !== null)
    const yes = band.filter(withP).map(metric)
    const no = band.filter((r) => !withP(r)).map(metric)
    if (yes.length < 5 || no.length < 5) continue
    const w = Math.min(yes.length, no.length)
    gap += (median(yes) - median(no)) * w
    weight += w
  }
  return weight ? gap / weight : null
}
const practiceRows = []
for (const [key, label] of Object.entries(PRACTICE_LABELS)) {
  const withP = (r) => !!hist.get(r.name)?.practices?.[key]?.present
  const users = repos.filter((r) => hist.has(r.name) && withP(r))
  if (users.length < 15) continue
  const raw = median(users.map((r) => r.score)) - median(repos.filter((r) => hist.has(r.name) && !withP(r)).map((r) => r.score))
  practiceRows.push({
    key, label, repos: users.length,
    rawScoreGap: raw,
    scoreGap: controlled((r) => r.score, withP),
    densityGap: controlled(density, withP),
  })
}
practiceRows.sort((a, b) => (b.scoreGap ?? -99) - (a.scoreGap ?? -99))
const sign = (x, d = 0) => (x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`)
out.push("## Do good practices go with healthier code?", "")
out.push(
  "Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares " +
    "repos of similar size and averages the gaps, which removes the effect of big projects both " +
    "adopting more and scoring lower. Density is findings per 1k lines — lower is better.",
  "",
)
out.push("| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |", "|---|---:|---:|---:|---:|")
for (const p of practiceRows) out.push(`| ${p.label} | ${p.repos} | ${sign(p.rawScoreGap)} | ${sign(p.scoreGap, 1)} | ${sign(p.densityGap, 2)} |`)
out.push("", "Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.", "")
json.practices = practiceRows

// --- the scanner on itself ----------------------------------------------------------------
const hidden = repos.reduce((s, r) => s + r.hidden, 0)
// --- distribution, severity, exposure ------------------------------------
json.scoreHistogram = Array.from({ length: 10 }, (_, b) =>
  repos.filter((r) => Math.min(9, Math.floor(r.score / 10)) === b).length)
json.severity = { critical: 0, warning: 0, info: 0 }
for (const r of repos) for (const i of r.issues) if (i.severity in json.severity) json.severity[i.severity]++
{
  const has = (r, re) => r.issues.some((i) => re.test(i.rule ?? ""))
  const share = (re, pool = repos) => (pool.length ? Number((pool.filter((r) => has(r, re)).length / pool.length).toFixed(3)) : 0)
  json.exposure = {
    injection: share(/^insecure-/),
    critical: Number((repos.filter((r) => r.issues.some((i) => i.severity === "critical")).length / repos.length).toFixed(3)),
    iac: share(/^iac-/),
    docker: share(/^docker-/),
    noLockfile: share(/^lockfile-missing$/),
  }
}

json.lowConfidenceHidden = hidden
json.shown = repos.reduce((s, r) => s + r.issues.length, 0)
json.precision = precisionByConfidence()
const shown = repos.reduce((s, r) => s + r.issues.length, 0)
out.push("## Noise the confidence scale hides", "")
out.push(`${hidden} low-confidence findings were kept out of these numbers (${pct(hidden, hidden + shown)} of everything the scanners raised).`, "")

// Score distributions for the "better than X% of projects" line on reports.
// Same cuts and size edges as lib/scan-stats.ts; main language = most lines.
{
  const bucket = (n) => (n < 1e3 ? "xs" : n < 1e4 ? "s" : n < 1e5 ? "m" : n < 1e6 ? "l" : "xl")
  const cuts = {}
  const add = (k, s) => (cuts[k] ??= []).push(s)
  for (const r of repos) {
    if (typeof r.score !== "number") continue
    const main = [...r.langs].sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))[0]?.language
    const size = bucket(r.langs.reduce((n, l) => n + (l.loc ?? 0), 0))
    add("all", r.score)
    add(`size:${size}`, r.score)
    if (main) {
      add(`lang:${main}`, r.score)
      add(`lang:${main}|size:${size}`, r.score)
    }
  }
  for (const k of Object.keys(cuts)) if (cuts[k].length < 30) delete cuts[k]
  for (const v of Object.values(cuts)) v.sort((a, b) => a - b)
  writeFileSync(join(here, "../lib/benchmark-scores.json"), JSON.stringify(cuts) + "\n")
}

// --- anonymous per-rule breakdown (no repo names, paths or code) ---------
{
  const where = (loc = "") => {
    const f = loc.split(":")[0].toLowerCase()
    if (/^\.github\/|(^|\/)\.gitlab-ci|(^|\/)\.circleci\//.test(f)) return "ci"
    if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures?|testdata)\/|[._-](test|spec)\.\w+$/.test(f)) return "tests"
    if (/(^|\/)(docs?|examples?|samples?|demos?|website)\/|\.(md|mdx|rst|txt)$/.test(f)) return "docs"
    if (/(^|\/)(vendor|third_party|node_modules|dist|build)\//.test(f)) return "vendored"
    if (/(^|\/)(dockerfile|docker-compose[^/]*|[^/]*\.(ya?ml|json|toml|tf|ini|cfg))$/.test(f)) return "config"
    if (!f || !f.includes(".") && !f.includes("/")) return "repo"
    return "source"
  }
  const rules = new Map()
  const get = (k) => rules.get(k) ?? rules.set(k, { count: 0, hidden: 0, repos: new Set(), sev: {}, where: {}, perRepo: new Map() }).get(k)
  for (const r of repos) {
    for (const i of r.issues) {
      const e = get(i.rule ?? i.scanner ?? "other")
      e.count++
      e.repos.add(r.name)
      e.sev[i.severity] = (e.sev[i.severity] ?? 0) + 1
      const w = where(i.location)
      e.where[w] = (e.where[w] ?? 0) + 1
      e.perRepo.set(r.name, (e.perRepo.get(r.name) ?? 0) + 1)
    }
    for (const i of r.low) get(i.rule ?? i.scanner ?? "other").hidden++
  }
  const conf = {}
  for (const m of readFileSync(join(here, "../packages/core/src/confidence-data.ts"), "utf8").matchAll(/"([^"]+)": \{ tp: (\d+), fp: (\d+)/g)) conf[m[1]] = { tp: +m[2], fp: +m[3] }
  const out2 = [...rules.entries()]
    .filter(([, e]) => e.count + e.hidden >= 20)
    .map(([rule, e]) => ({
      rule,
      count: e.count,
      hidden: e.hidden,
      repoShare: Number((e.repos.size / repos.length).toFixed(3)),
      medianPerRepo: e.repos.size ? median([...e.perRepo.values()]) : 0,
      severity: Object.entries(e.sev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      where: Object.fromEntries(Object.entries(e.where).map(([k, v]) => [k, Number((v / e.count).toFixed(3))])),
      labelled: conf[rule] ?? null,
    }))
    .sort((a, b) => b.count + b.hidden - (a.count + a.hidden))
  writeFileSync(join(here, "findings.json"), JSON.stringify({ generatedAt: json.generatedAt, repos: repos.length, rules: out2 }, null, 2) + "\n")
}

writeFileSync(join(here, "STATS.md"), out.join("\n"))
writeFileSync(join(here, "stats.json"), JSON.stringify(json, null, 2) + "\n")
console.log(`STATS.md and stats.json written for ${n} repos`)
