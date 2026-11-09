#!/usr/bin/env node
/**
 * How the corpus got where it is: adoption timelines and activity by year,
 * read straight from each clone's git history.
 *
 *   node benchmark/history.mjs   → benchmark/.history/<repo>.json + benchmark/history.json
 *
 * Per repo: the first commit, commits and distinct authors per year, and the
 * date each practice first appeared (file added) or was dropped (file removed).
 * Reads raw git data from .gitlog/<repo>.json.gz (built by run.mjs from its
 * clone, or by gitlog.mjs from blob-less clones); a record is rebuilt from it
 * without any clone when the schema or a marker changes.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, ".cache")
const outDir = join(here, ".history")
mkdirSync(outDir, { recursive: true })
const corpus = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"))

/**
 * Practices tracked by the path that marks them. `added` is the first commit
 * adding a matching path, `removed` the last commit deleting one.
 */
const PRACTICES = {
  githubActions: [".github/workflows/"],
  travis: [".travis.yml"],
  circleci: [".circleci/"],
  appveyor: ["appveyor.yml", ".appveyor.yml"],
  dependabot: [".github/dependabot.yml", ".github/dependabot.yaml"],
  renovate: ["renovate.json", ".github/renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json"],
  security: ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"],
  codeowners: [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"],
  codeOfConduct: ["CODE_OF_CONDUCT.md", ".github/CODE_OF_CONDUCT.md"],
  contributing: ["CONTRIBUTING.md", ".github/CONTRIBUTING.md"],
  funding: [".github/FUNDING.yml"],
  issueTemplates: [".github/ISSUE_TEMPLATE/"],
  prTemplate: [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md"],
  codeql: [".github/workflows/codeql.yml", ".github/workflows/codeql-analysis.yml"],
  scorecard: [".github/workflows/scorecard.yml", ".github/workflows/scorecards.yml"],
  packageLock: ["package-lock.json"],
  yarnLock: ["yarn.lock"],
  pnpmLock: ["pnpm-lock.yaml"],
  bunLock: ["bun.lockb", "bun.lock"],
  tsconfig: ["tsconfig.json"],
  eslintLegacy: [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.cjs"],
  eslintFlat: ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", "eslint.config.cjs"],
  biome: ["biome.json", "biome.jsonc"],
  prettier: [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", ".prettierrc.yml"],
  pyproject: ["pyproject.toml"],
  setupPy: ["setup.py"],
  ruff: ["ruff.toml", ".ruff.toml"],
  preCommit: [".pre-commit-config.yaml"],
  docker: ["Dockerfile"],
  devcontainer: [".devcontainer/"],
  changeset: [".changeset/"],
  editorconfig: [".editorconfig"],
  nvmrc: [".nvmrc", ".node-version"],
  // Python packaging: which tool a project settled on.
  uvLock: ["uv.lock"],
  poetryLock: ["poetry.lock"],
  pipenv: ["Pipfile", "Pipfile.lock"],
  requirements: ["requirements.txt"],
  // Front-end build tools.
  vite: ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"],
  webpack: ["webpack.config.js", "webpack.config.ts", "webpack.config.cjs", "webpack.config.mjs"],
  // Instructions written for AI coding agents.
  aiClaude: ["CLAUDE.md", ".claude/"],
  aiAgents: ["AGENTS.md"],
  aiCursor: [".cursorrules", ".cursor/rules/"],
  aiCopilot: [".github/copilot-instructions.md"],
  aiGemini: ["GEMINI.md"],
  aiWindsurf: [".windsurfrules"],
}
/** Bumped when a record gains fields, so cached records are rebuilt. */
const SCHEMA = 2
const AI = ["aiClaude", "aiAgents", "aiCursor", "aiCopilot", "aiGemini", "aiWindsurf"]

function git(dir, args) {
  return new Promise((resolve) => {
    const p = spawn("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    p.stdout.on("data", (d) => (out += d))
    p.on("close", () => resolve(out))
  })
}

/** Files whose text a record needs: workflows (action versions) and Dockerfiles (base images). */
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/
const DOCKER_FILE = /(^|\/)(?:Dockerfile|[\w.-]+\.Dockerfile|Dockerfile\.[\w.-]+)$/
const VENDORED = /(^|\/)(?:vendor|node_modules|third_party)\//

/**
 * Everything a history record is computed from, read once from a clone (full
 * or blob-less): commits with author and year, every add/delete with its date,
 * the file list at the pinned commit, and the texts of workflows and
 * Dockerfiles. Stored gzipped in .gitlog/, so a new practice marker or a new
 * statistic is recomputed for 3,000 repos without cloning any of them.
 */
export async function collectGitData(dir, sha) {
  const log = await git(dir, ["log", sha, "--format=%ad\t%aE", "--date=format:%Y", "--no-merges"])
  const changes = await git(dir, ["log", sha, "--reverse", "--format=@%ad", "--date=short", "--name-status", "--diff-filter=AD", "--no-renames"])
  const tree = (await git(dir, ["ls-tree", "-r", "--name-only", sha])).split("\n").filter(Boolean)
  const files = {}
  const wanted = [
    ...tree.filter((f) => WORKFLOW_FILE.test(f)).slice(0, 40),
    ...tree.filter((f) => DOCKER_FILE.test(f) && !VENDORED.test(f)).slice(0, 10),
  ]
  for (const f of wanted) files[f] = await git(dir, ["show", `${sha}:${f}`])
  return { sha, log, changes, tree, files }
}

const gitlogDir = join(here, ".gitlog")
export function saveGitData(name, data) {
  mkdirSync(gitlogDir, { recursive: true })
  writeFileSync(join(gitlogDir, `${name}.json.gz`), gzipSync(JSON.stringify(data)))
}
export function loadGitData(name, sha) {
  const p = join(gitlogDir, `${name}.json.gz`)
  if (!existsSync(p)) return null
  try {
    const d = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"))
    return d.sha === sha ? d : null
  } catch {
    return null
  }
}

async function one(repo) {
  const outFile = join(outDir, `${repo.name}.json`)
  if (existsSync(outFile)) {
    const prev = JSON.parse(readFileSync(outFile, "utf8"))
    if (prev.sha === repo.sha && prev.schema === SCHEMA) return prev
  }
  let data = loadGitData(repo.name, repo.sha)
  if (!data) {
    const dir = join(cacheDir, repo.name)
    if (!existsSync(dir)) return null
    data = await collectGitData(dir, repo.sha)
    saveGitData(repo.name, data)
  }
  return buildRecord(repo, data, outFile)
}

export function buildRecord(repo, data, outFile) {
  const { log, changes } = data
  // Commits and authors by year, on the history leading to the pinned commit.
  const byYear = {}
  const authors = {}
  const allAuthors = new Map()
  for (const line of log.split("\n")) {
    const [year, email] = line.split("\t")
    if (!year) continue
    byYear[year] = (byYear[year] ?? 0) + 1
    ;(authors[year] ??= new Set()).add(email)
    allAuthors.set(email, (allAuthors.get(email) ?? 0) + 1)
  }
  const years = Object.keys(byYear).sort()
  const total = [...allAuthors.values()].reduce((a, b) => a + b, 0)
  const top = Math.max(0, ...allAuthors.values())

  // One pass over every add/delete in history, oldest first.
  const practices = {}
  let date = ""
  for (const line of changes.split("\n")) {
    if (line.startsWith("@")) {
      date = line.slice(1)
      continue
    }
    const m = line.match(/^([AD])\t(.+)$/)
    if (!m) continue
    const [, kind, path] = m
    for (const [name, paths] of Object.entries(PRACTICES)) {
      if (!paths.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))) continue
      const rec = (practices[name] ??= {})
      if (kind === "A" && !rec.added) rec.added = date
      if (kind === "D") rec.removed = date
    }
  }
  // Present at the pinned commit? A file can be removed and re-added.
  const tree = new Set(data.tree)
  for (const [name, paths] of Object.entries(PRACTICES)) {
    const present = [...tree].some((f) => paths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)))
    if (practices[name]) practices[name].present = present
    else if (present) practices[name] = { present, added: years[0] ? `${years[0]}-01-01` : undefined }
  }

  // Snapshot at the pinned commit: which action versions and base images it uses.
  const show = (f) => data.files[f] ?? ""
  const actions = {}
  let usesTotal = 0
  let usesSha = 0
  for (const f of [...tree].filter((f) => WORKFLOW_FILE.test(f)).slice(0, 40)) {
    for (const m of show(f).matchAll(/^\s*-?\s*uses:\s*["']?([\w.-]+\/[\w.-]+)(?:\/[^@\s"']*)?@([^\s"'#]+)["']?(?:\s*#\s*(\S+))?/gm)) {
      const [, name, ref, comment] = m
      usesTotal++
      if (/^[0-9a-f]{40}$/.test(ref)) usesSha++
      // Keep the oldest major version seen per action: that is the one that ages out first.
      // A SHA pin carries its version in the trailing comment (`@<sha> # v4.2.2`).
      const label = /^[0-9a-f]{40}$/.test(ref) ? comment ?? "" : ref
      const major = /^v?(\d+)(?:\.|$)/.exec(label)?.[1]
      if (major === undefined) continue
      if (actions[name] === undefined || Number(major) < actions[name]) actions[name] = Number(major)
    }
  }
  const dockerBases = []
  for (const f of [...tree].filter((f) => DOCKER_FILE.test(f) && !VENDORED.test(f)).slice(0, 10)) {
    const text = show(f)
    const stages = new Set([...text.matchAll(/^\s*FROM\s+\S+\s+AS\s+(\S+)/gim)].map((m) => m[1].toLowerCase()))
    for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
      const image = m[1].toLowerCase()
      if (stages.has(image) || image.includes("$")) continue
      dockerBases.push(image)
    }
  }

  const rec = {
    schema: SCHEMA,
    repo: repo.name,
    url: repo.url,
    sha: repo.sha,
    firstCommit: years[0] ?? null,
    commitsByYear: byYear,
    authorsByYear: Object.fromEntries(Object.entries(authors).map(([y, s]) => [y, s.size])),
    authorsTotal: allAuthors.size,
    topAuthorShare: total ? Number((top / total).toFixed(3)) : 0,
    practices,
    actions,
    actionUses: { total: usesTotal, sha: usesSha },
    dockerBases: [...new Set(dockerBases)].slice(0, 20),
  }
  writeFileSync(outFile, JSON.stringify(rec))
  return rec
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
// `history.mjs repo…` refreshes just those repos (run.mjs calls it before it
// drops a clone); the corpus-wide curves are always rebuilt from every cached file.
const only = process.argv.slice(2)
const jobs = Number(process.env.BENCH_JOBS ?? 8)
const queue = corpus.filter((r) => !only.length || only.includes(r.name))
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length) await one(queue.shift())
  }),
)
// A per-repo refresh (from run.mjs) stops here: the corpus-wide file is rebuilt
// once, by a plain `history.mjs` run, not rewritten after every repo.
if (only.length) process.exit(0)
const results = corpus
  .map((r) => join(outDir, `${r.name}.json`))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, "utf8")))

// Corpus-wide adoption curves: share of repos (alive that year) using a practice.
const yearsAll = []
for (let y = 2010; y <= new Date().getFullYear(); y++) yearsAll.push(String(y))
const alive = (r, y) => r.firstCommit && r.firstCommit <= y
const usedIn = (p, y) => p && p.added && p.added.slice(0, 4) <= y && (!p.removed || p.present || p.removed.slice(0, 4) > y)
const adoption = {}
for (const name of Object.keys(PRACTICES)) {
  adoption[name] = {}
  for (const y of yearsAll) {
    const pool = results.filter((r) => alive(r, y))
    if (pool.length < 20) continue
    adoption[name][y] = Number((pool.filter((r) => usedIn(r.practices[name], y)).length / pool.length).toFixed(3))
  }
}
// AI agent instructions arrived in 2024–2026: yearly points are too coarse, so
// also a monthly curve from 2023 of the share of all repos that had any such file.
const aiMonthly = {}
const months = []
for (let y = 2023; y <= new Date().getFullYear(); y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`)
const lastSeen = results.reduce((a, r) => Math.max(a, ...Object.values(r.practices ?? {}).map((p) => (p.added ? Date.parse(p.added) : 0))), 0)
const cutoff = new Date(lastSeen).toISOString().slice(0, 7)
for (const name of [...AI, "any"]) aiMonthly[name] = {}
for (const mo of months.filter((m) => m <= cutoff)) {
  const pool = results.filter((r) => r.firstCommit && r.firstCommit <= mo.slice(0, 4))
  const on = (p) => p && p.added && p.added.slice(0, 7) <= mo && (!p.removed || p.present || p.removed.slice(0, 7) > mo)
  for (const name of AI) aiMonthly[name][mo] = Number((pool.filter((r) => on(r.practices[name])).length / pool.length).toFixed(4))
  aiMonthly.any[mo] = Number((pool.filter((r) => AI.some((n) => on(r.practices[n]))).length / pool.length).toFixed(4))
}

const activity = {}
for (const y of yearsAll) {
  const pool = results.filter((r) => alive(r, y))
  if (pool.length < 20) continue
  const commits = pool.map((r) => r.commitsByYear[y] ?? 0).sort((a, b) => a - b)
  const authors = pool.map((r) => r.authorsByYear[y] ?? 0).sort((a, b) => a - b)
  activity[y] = {
    repos: pool.length,
    medianCommits: commits[Math.floor(commits.length / 2)],
    medianAuthors: authors[Math.floor(authors.length / 2)],
    dormant: Number((commits.filter((c) => c === 0).length / pool.length).toFixed(3)),
  }
}
writeFileSync(
  join(here, "history.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), repos: results.length, adoption, aiMonthly, activity }, null, 2) + "\n",
)
console.log(`history for ${results.length} repos → benchmark/history.json`)
}
