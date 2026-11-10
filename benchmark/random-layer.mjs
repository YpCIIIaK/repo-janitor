#!/usr/bin/env node
/**
 * The random layer: repositories drawn at random from active public GitHub
 * projects, so corpus-wide percentages can be stated without the bias of a
 * hand-picked corpus.
 *
 * Population: public, not a fork, not archived, at least 10 stars (to leave out
 * empty and personal scratch repos), pushed within the last 12 months.
 *
 * Draw: GitHub search answers at most 1,000 results per query, so the
 * population is split into creation-date windows sized to hold a few hundred
 * repos each (a week in early years, a day recently). A window is drawn
 * uniformly, its repo count is read, and the window is kept with probability
 * count / 1000 (rejection sampling); then one repo inside it is drawn
 * uniformly. Every repo of the population therefore has the same chance,
 * whichever window it falls in. A window holding more than 1,000 repos can
 * only be sampled from its first 1,000; such draws are counted in `overCap`.
 *
 *   node benchmark/random-layer.mjs draw --n 1000 [--seed 20261109]   → random-layer.json
 *   node benchmark/random-layer.mjs apply                             pin SHAs, add to corpus.json
 *
 * Unauthenticated search allows 10 requests a minute; a draw of 1,000 takes
 * a few hours and is resumable (progress is kept in random-layer.json).
 * With GITHUB_SEARCH_TOKEN (or GITHUB_TOKEN) set, 30 a minute: about 3x faster.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const statePath = join(here, "random-layer.json")
const corpusPath = join(here, "corpus.json")
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)

const FIRST_DAY = Date.UTC(2010, 0, 1)
const CAP = 1000 // GitHub search returns at most this many results per query
const MAX_SIZE_KB = 1_500_000 // keep under the 2 GB clone limit

/** Deterministic RNG (mulberry32), so a draw can be reproduced from its seed. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastCall = 0
// Optional token (no scopes needed): search allows 30 requests a minute instead of 10.
const token = process.env.GITHUB_SEARCH_TOKEN || process.env.GITHUB_TOKEN || ""
const gap = token ? 2200 : 6500
async function search(q, page = 1, perPage = 100) {
  // Stay under the search rate limit.
  const wait = lastCall + gap - Date.now()
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "repo-janitor-benchmark", ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
    if (res.ok) return res.json()
    if (res.status === 401 || res.status >= 500) { await sleep(10000 * (attempt + 1)); continue }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000
      await sleep(Math.max(15000, reset - Date.now() + 2000))
      continue
    }
    throw new Error(`search failed: HTTP ${res.status}`)
  }
  throw new Error("search kept hitting the rate limit")
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10)

async function draw() {
  const n = Number(opt("--n", 1000))
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { seed: Number(opt("--seed", Number(day(Date.now()).replaceAll("-", "")))), drawnAt: day(Date.now()), picked: [], tries: 0 }
  const pushedSince = day(Date.parse(state.drawnAt) - 365 * 24 * 3600 * 1000)
  const lastDay = Date.parse(state.drawnAt) - 30 * 24 * 3600 * 1000
  state.population = `public, not a fork, not archived, stars >= 10, pushed since ${pushedSince}, created ${day(FIRST_DAY)}..${day(lastDay)}`
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"))
  const known = new Set([...corpus.map((r) => r.url.toLowerCase()), ...state.picked.map((p) => p.url.toLowerCase())])
  // Count RNG calls in the state, so a resumed draw continues the exact same sequence.
  const base = rng(state.seed)
  state.rngCalls ??= 0
  for (let i = 0; i < state.rngCalls; i++) base()
  const rand = () => (state.rngCalls++, base())
  // Fixed partition of the timeline into windows; longer where fewer repos are created.
  const windowDays = (ms) => {
    const y = new Date(ms).getUTCFullYear()
    return y <= 2019 ? 7 : y <= 2022 ? 4 : y <= 2024 ? 3 : 1
  }
  const windows = []
  for (let t = FIRST_DAY; t < lastDay; ) {
    const len = windowDays(t)
    const end = Math.min(t + len * 86400000, lastDay)
    windows.push([day(t), day(end - 86400000)])
    t = end
  }
  state.windows = windows.length
  state.overCap ??= 0
  while (state.picked.length < n) {
    const [from, to] = windows[Math.floor(rand() * windows.length)]
    const u = rand()
    state.tries++
    const q = `created:${from}..${to} pushed:>=${pushedSince} stars:>=10 fork:false archived:false`
    const head = await search(q, 1, 1)
    if ((head.total_count ?? 0) > CAP) state.overCap++
    const count = Math.min(head.total_count ?? 0, CAP)
    // Rejection sampling: keep the day with probability count / CAP.
    if (count === 0 || u >= count / CAP) { save(state); continue }
    const i = Math.floor(rand() * count)
    const page = await search(q, Math.floor(i / 100) + 1, 100)
    const repo = page.items?.[i % 100]
    if (!repo || repo.size > MAX_SIZE_KB || known.has(repo.html_url.toLowerCase())) { save(state); continue }
    known.add(repo.html_url.toLowerCase())
    state.picked.push({ url: repo.html_url, stars: repo.stargazers_count, created: from, language: repo.language })
    if (state.picked.length % 25 === 0) console.log(`${state.picked.length}/${n} picked after ${state.tries} draws`)
    save(state)
  }
  console.log(`done: ${state.picked.length} repos in ${state.tries} draws`)
}

function save(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 1) + "\n")
}

function apply() {
  const state = JSON.parse(readFileSync(statePath, "utf8"))
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"))
  const byUrl = new Map(corpus.map((r) => [r.url.toLowerCase(), r]))
  let added = 0
  for (const p of state.picked) {
    const existing = byUrl.get(p.url.toLowerCase())
    if (existing) {
      existing.tracks = [...new Set([...(existing.tracks ?? []), "random"])]
      continue
    }
    let sha
    try {
      sha = execFileSync("git", ["ls-remote", p.url, "HEAD"], { encoding: "utf8", timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).split(/\s/)[0]
    } catch { continue }
    if (!sha) continue
    const name = p.url.replace(/^https:\/\/github\.com\//i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    corpus.push({ name, url: p.url, sha, layer: "random" })
    added++
  }
  writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n")
  console.log(`added ${added} random-layer repos; corpus ${corpus.length}`)
}

const cmd = argv[0]
if (cmd === "draw") await draw()
else if (cmd === "apply") apply()
else {
  console.error("usage: random-layer.mjs draw --n 1000 [--seed N] | apply")
  process.exit(1)
}
