// Harvest a sink/source/sanitizer DB offline from mature scanners (sinks-schema.md):
//   Progpilot (PHP JSON) + CodeQL models-as-data (Java/Go/JS JSON) + Bandit blacklists (Python).
// Output: { _meta, entries:[{lang,class,sinks,guard,note}], records:[unified schema] }.
// `entries` is the compact per lang×class view consumed by real-advisory-fast.mjs (SINKS=).
// Curated sinks.json entries are merged in first (they carry hand-written guards/notes);
// harvested symbols are appended, ranked by how many distinct upstream rows name them.
//
// Usage: node benchmark/sinks-harvest.mjs <upstreamDir> <curatedSinks.json> <out.json>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CWE_CLASS } from './recall.mjs'

const [UP, CURATED, OUT] = process.argv.slice(2)
const sha = d => { try { return execFileSync('git', ['-C', join(UP, d), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return '?' } }
const records = []
const add = r => records.push(r)

// ---------- Progpilot (PHP) ----------
const PP_CLASS = { xss: 'xss', sql_injection: 'sqli', command_injection: 'cmdi', code_injection: 'code-injection',
  file_inclusion: 'code-injection', path_traversal: 'path-traversal', xml_injection: 'xxe', redos: 'redos', ssrf: 'ssrf',
  open_redirect: 'open-redirect', object_injection: 'deserialization', deserialization: 'deserialization' }
const ppCls = a => PP_CLASS[a] ?? PP_CLASS[String(a).split(' ').pop()] ?? null
{
  const base = join(UP, 'progpilot/package/src/uptodate_data/php'), prov = `progpilot@${sha('progpilot')}`
  const dirs = [[base, null], ...readdirSync(join(base, 'frameworks')).map(f => [join(base, 'frameworks', f), f])]
  for (const [d, fw] of dirs) {
    const rd = f => existsSync(join(d, f)) ? JSON.parse(readFileSync(join(d, f), 'utf8')) : {}
    for (const s of rd('sinks.json').sinks || []) {
      const cls = ppCls(s.attack) ?? CWE_CLASS[Number(String(s.cwe).replace(/\D/g, ''))]
      if (!cls || s.language !== 'php') continue
      add({ lang: 'php', kind: 'sink', class: cls, framework: fw, callee: s.name, receiver: s.instanceof ?? null,
        arg: (s.parameters || []).map(p => p.id - 1), requiresTaint: true, provenance: prov })
    }
    for (const s of rd('sanitizers.json').sanitizers || []) {
      if (s.language !== 'php') continue
      for (const p of [].concat(s.prevent || [])) { const cls = ppCls(p); if (cls) add({ lang: 'php', kind: 'sanitizer', class: cls, framework: fw, callee: s.name, receiver: s.instanceof ?? null, provenance: prov }) }
    }
  }
}

// ---------- CodeQL models-as-data (Java, Go, JavaScript) ----------
const CQ_CLASS = { 'sql-injection': 'sqli', 'nosql-injection': 'sqli', 'path-injection': 'path-traversal',
  'command-injection': 'cmdi', 'code-injection': 'code-injection', 'template-injection': 'code-injection',
  'ognl-injection': 'code-injection', 'mvel-injection': 'code-injection', 'groovy-injection': 'code-injection',
  'jexl-injection': 'code-injection', 'jndi-injection': 'code-injection', 'request-forgery': 'ssrf',
  'html-injection': 'xss', 'url-redirection': 'open-redirect', 'unsafe-deserialization': 'deserialization',
  'xxe': 'xxe', 'regex-use': 'redos' }
{
  const prov = `codeql@${sha('codeql')}`
  for (const [lang, dir] of [['java', 'java'], ['go', 'go'], ['javascript', 'javascript']]) {
    const d = join(UP, 'codeql', dir, 'ql/lib/ext'); if (!existsSync(d)) continue
    for (const f of readdirSync(d).filter(f => f.endsWith('.json'))) {
      let j; try { j = JSON.parse(readFileSync(join(d, f), 'utf8')) } catch { continue }
      for (const ext of j.extensions || []) {
        const kindName = ext.addsTo?.extensible; if (!['sinkModel', 'sourceModel'].includes(kindName)) continue
        for (const row of ext.data || []) {
          if (lang === 'javascript') {           // [type, path, kind]
            const [type, path, kind] = row, cls = CQ_CLASS[String(kind).replace(/\[.*$/, '')]
            if (!cls) continue
            const members = [...String(path).matchAll(/Member\[([^\]]+)\]/g)].map(m => m[1])
            add({ lang, kind: kindName === 'sinkModel' ? 'sink' : 'source', class: cls, framework: type.split('.')[0],
              callee: [type.split('.')[0], ...members].join('.'), receiver: null, arg: [], requiresTaint: true, provenance: prov })
          } else {                               // [package, type, subtypes, name, signature, ext, input, kind, provenance]
            const [pkg, type, , name, , , input, kind] = row, cls = CQ_CLASS[String(kind).replace(/\[.*$/, '')]
            if (!cls || kindName !== 'sinkModel') continue
            const a = /Argument\[(\d+)/.exec(input || '')
            add({ lang, kind: 'sink', class: cls, framework: pkg, callee: `${type ? type + '.' : ''}${name}`, receiver: pkg,
              arg: a ? [+a[1]] : [], requiresTaint: true, provenance: prov })
          }
        }
      }
    }
  }
}

// ---------- Bandit (Python) ----------
const BANDIT_CLASS = n => /pickle|marshal|yaml|shelve|dill|jsonpickle/.test(n) ? 'deserialization'
  : /xml|lxml|expat|sax|minidom|pulldom|etree/.test(n) ? 'xxe'
  : /mark_safe/.test(n) ? 'xss' : /eval|exec|compile/.test(n) ? 'code-injection'
  : /subprocess|popen|os\.system|spawn|shell|telnet/.test(n) ? 'cmdi'
  : /urllib|urlopen|requests/.test(n) ? 'ssrf' : /tarfile|extractall|zipfile/.test(n) ? 'path-traversal'
  : /md5|sha1|des|rc4|cipher|random/.test(n) ? 'crypto' : /ssl|verify/.test(n) ? 'tls' : null
{
  const prov = `bandit@${sha('bandit')}`
  for (const file of ['calls.py', 'imports.py']) {
    const src = readFileSync(join(UP, 'bandit/bandit/blacklists', file), 'utf8')
    for (const m of src.matchAll(/build_conf_dict\(\s*"([^"]+)",\s*"(B\d+)",[\s\S]*?\[([\s\S]*?)\]/g)) {
      const [, group, bid, list] = m
      for (const q of [...list.matchAll(/"([^"]+)"/g)].map(x => x[1])) {
        const cls = BANDIT_CLASS(`${group} ${q}`.toLowerCase()); if (!cls) continue
        add({ lang: 'python', kind: 'sink', class: cls, framework: null, callee: q, receiver: null, arg: [0],
          requiresTaint: !['deserialization', 'xxe', 'crypto', 'tls'].includes(cls), note: bid, provenance: prov })
      }
    }
  }
}

// ---------- merge: dedupe records, build compact entries ----------
const byId = new Map()
for (const r of records) {
  const id = `${r.lang}.${r.class}.${r.kind}.${r.receiver ? r.receiver + '::' : ''}${r.callee}`
  const cur = byId.get(id)
  if (cur) { cur.weight++; if (!cur.provenance.includes(r.provenance)) cur.provenance.push(r.provenance) }
  else byId.set(id, { id, ...r, provenance: [r.provenance], weight: 1 })
}
const recs = [...byId.values()]
const DEV = /^(my|some|known_|unknown_|test)/i
const label = r => r.lang === 'php' && r.receiver && !DEV.test(r.receiver) ? `${r.receiver}->${r.callee}()` : `${r.callee}()`
const curated = JSON.parse(readFileSync(CURATED, 'utf8')).entries
const keys = new Set([...curated.map(e => `${e.lang}/${e.class}`), ...recs.map(r => `${r.lang}/${r.class}`)])
const CAP = Number(process.env.CAP || 30)
const entries = []
for (const k of keys) {
  const [lang, cls] = k.split('/'), c = curated.find(e => e.lang === lang && e.class === cls)
  // round-robin across receivers/types so a capped list covers many APIs, not 30 methods of one class
  const pick = kind => {
    const rs = recs.filter(r => r.lang === lang && r.class === cls && r.kind === kind && !DEV.test(r.callee) && !DEV.test(r.receiver || ''))
      .sort((a, b) => b.weight - a.weight)
    const groups = new Map()
    for (const r of rs) { const g = `${r.receiver || ''}|${r.callee.includes('.') ? r.callee.split('.').slice(0, -1).join('.') : r.callee}`; (groups.get(g) || groups.set(g, []).get(g)).push(r) }
    const out = [], lists = [...groups.values()]
    for (let i = 0; out.length < rs.length; i++) for (const l of lists) if (l[i]) out.push(label(l[i]))
    return [...new Set(out)]
  }
  const sinks = [...new Set([...(c?.sinks || []), ...pick('sink')])].slice(0, CAP)
  const guard = [...new Set([...(c?.guard || []), ...pick('sanitizer').slice(0, 12)])]
  if (!sinks.length) continue
  entries.push({ lang, class: cls, sinks, guard, ...(c?.note ? { note: c.note } : {}), harvested: pick('sink').length })
}
entries.sort((a, b) => (a.lang + a.class).localeCompare(b.lang + b.class))
writeFileSync(OUT, JSON.stringify({ _meta: `Harvested sink DB (curated + ${[...new Set(recs.flatMap(r => r.provenance))].join(', ')}). Generic API knowledge, not advisory answers. Built by benchmark/sinks-harvest.mjs.`,
  generated: new Date().toISOString().slice(0, 10), entries, records: recs }, null, 1))
console.log(`records=${recs.length} entries=${entries.length}`)
for (const e of entries) console.log(`${e.lang.padEnd(11)} ${e.class.padEnd(16)} sinks=${e.sinks.length} (harvested ${e.harvested}) guard=${e.guard.length}`)
