#!/usr/bin/env node
/**
 * How the corpus got where it is: adoption timelines and activity by year,
 * read straight from each clone's git history.
 *
 *   node benchmark/history.mjs   → benchmark/.history/<repo>.json + benchmark/history.json
 *
 * Per repo: the first commit, commits and distinct authors per year, and the
 * date each practice first appeared (file added) or was dropped (file removed).
 * Needs the full clones `run.mjs` keeps in .cache. Cached per repo by commit,
 * so a rerun only reads repos whose pinned SHA changed.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
}

function git(dir, args) {
  return new Promise((resolve) => {
    const p = spawn("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    p.stdout.on("data", (d) => (out += d))
    p.on("close", () => resolve(out))
  })
}

async function one(repo) {
  const dir = join(cacheDir, repo.name)
  if (!existsSync(dir)) return null
  const outFile = join(outDir, `${repo.name}.json`)
  if (existsSync(outFile)) {
    const prev = JSON.parse(readFileSync(outFile, "utf8"))
    if (prev.sha === repo.sha) return prev
  }

  // Commits and authors by year, on the history leading to the pinned commit.
  const log = await git(dir, ["log", repo.sha, "--format=%ad\t%aE", "--date=format:%Y", "--no-merges"])
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
  const changes = await git(dir, [
    "log", repo.sha, "--reverse", "--format=@%ad", "--date=short", "--name-status", "--diff-filter=AD", "--no-renames",
  ])
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
  const tree = new Set((await git(dir, ["ls-tree", "-r", "--name-only", repo.sha])).split("\n"))
  for (const [name, paths] of Object.entries(PRACTICES)) {
    const present = [...tree].some((f) => paths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)))
    if (practices[name]) practices[name].present = present
    else if (present) practices[name] = { present, added: years[0] ? `${years[0]}-01-01` : undefined }
  }

  const rec = {
    repo: repo.name,
    url: repo.url,
    sha: repo.sha,
    firstCommit: years[0] ?? null,
    commitsByYear: byYear,
    authorsByYear: Object.fromEntries(Object.entries(authors).map(([y, s]) => [y, s.size])),
    authorsTotal: allAuthors.size,
    topAuthorShare: total ? Number((top / total).toFixed(3)) : 0,
    practices,
  }
  writeFileSync(outFile, JSON.stringify(rec))
  return rec
}

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
  JSON.stringify({ generatedAt: new Date().toISOString(), repos: results.length, adoption, activity }, null, 2) + "\n",
)
console.log(`history for ${results.length} repos → benchmark/history.json`)
