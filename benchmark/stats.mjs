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
  })
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
json.todo = { dated: todoAges.length, medianDays: median(todoAges) }

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
for (const [label, a, b] of buckets) {
  const l = repos.filter((r) => r.loc >= a && r.loc < b)
  out.push(`| ${label} | ${l.length} | ${median(l.map((r) => r.score))} |`)
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
  if (existsSync(p)) hist.set(r.name, JSON.parse(readFileSync(p, "utf8")))
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
const shown = repos.reduce((s, r) => s + r.issues.length, 0)
out.push("## Noise the confidence scale hides", "")
out.push(`${hidden} low-confidence findings were kept out of these numbers (${pct(hidden, hidden + shown)} of everything the scanners raised).`, "")

writeFileSync(join(here, "STATS.md"), out.join("\n"))
writeFileSync(join(here, "stats.json"), JSON.stringify(json, null, 2) + "\n")
console.log(`STATS.md and stats.json written for ${n} repos`)
