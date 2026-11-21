// Gap analysis: would the harvested sink DB help the fast engine? For every advisory the fast engine
// MISSED, fetch the fix diff (gh api, cached) and check whether a removed/changed line calls a harvested
// sink of the advisory's class. That is an upper bound on what new sink-name rules could recover, and
// tells which lang×class slices are worth turning into rules.
//
// Usage: node benchmark/sinks-gap.mjs <sinks-harvested.json> <advisories.json> <recall-journal.jsonl> <diffCacheDir>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

const [DB, ADV, JOURNAL, CACHE] = process.argv.slice(2)
mkdirSync(CACHE, { recursive: true })
const LANG = { javascript: 'javascript', typescript: 'javascript', php: 'php', python: 'python', go: 'go', java: 'java', ruby: 'ruby' }
const recs = JSON.parse(readFileSync(DB, 'utf8')).records.filter(r => r.kind === 'sink')
const cases = (j => j.cases || j)(JSON.parse(readFileSync(ADV, 'utf8')))
const rows = readFileSync(JOURNAL, 'utf8').split('\n').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
const fastHit = new Set(rows.filter(r => r.engine === 'fast' && r.verdict === 'hit').map(r => r.id))
const fastSeen = new Set(rows.filter(r => r.engine === 'fast').map(r => r.id))

// method name -> regex; keep names >= 4 chars (short ones like `get`/`run` match everything)
const nameOf = r => r.callee.split(/[.:>-]+/).pop()
const sinkRe = new Map()
for (const r of recs) {
  const n = nameOf(r); if (!n || n.length < 4 || !/^\w+$/.test(n)) continue
  const k = `${r.lang}/${r.class}`; (sinkRe.get(k) || sinkRe.set(k, new Set()).get(k)).add(n)
}
const reFor = k => sinkRe.has(k) ? new RegExp(`\\b(${[...sinkRe.get(k)].join('|')})\\s*\\(`) : null

const todo = cases.filter(c => fastSeen.has(c.id) && !fastHit.has(c.id) && LANG[c.language] && sinkRe.has(`${LANG[c.language]}/${c.class}`) && c.source?.type === 'git')
console.error(`missed with a harvested slice: ${todo.length}`)

async function diff(c) {
  const f = join(CACHE, `${c.id}.diff`)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  const repo = c.source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  try {
    const { stdout } = await run('gh', ['api', `repos/${repo}/commits/${c.source.fixed}`, '-H', 'Accept: application/vnd.github.diff'], { maxBuffer: 64 << 20 })
    writeFileSync(f, stdout); return stdout
  } catch { writeFileSync(f, ''); return '' }
}

const out = {}
const POOL = 6
for (let i = 0; i < todo.length; i += POOL) await Promise.all(todo.slice(i, i + POOL).map(async c => {
  const k = `${LANG[c.language]}/${c.class}`, d = await diff(c), re = reFor(k)
  const o = out[k] ??= { missed: 0, nodiff: 0, sinkInDiff: 0, ids: [] }
  o.missed++
  if (!d) { o.nodiff++; return }
  // vulnerable side only: removed lines, plus context lines inside hunks (the sink call often stays and the guard is added)
  const lines = d.split('\n').filter(l => /^[- ]/.test(l) && !/^---/.test(l))
  const hit = lines.find(l => re.test(l))
  if (hit) { o.sinkInDiff++; o.ids.push(`${c.id} ${hit.trim().slice(0, 90)}`) }
}))
console.log('slice'.padEnd(28), 'missed nodiff sinkInDiff')
for (const [k, o] of Object.entries(out).sort((a, b) => b[1].sinkInDiff - a[1].sinkInDiff)) console.log(k.padEnd(28), String(o.missed).padEnd(6), String(o.nodiff).padEnd(6), o.sinkInDiff)
writeFileSync(join(CACHE, '..', 'sinks-gap.json'), JSON.stringify(out, null, 1))
