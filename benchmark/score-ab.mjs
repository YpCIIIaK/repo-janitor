// A/B: baseline (no sink reference) vs sinks arm. Same cases, same role models.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const labels = JSON.parse(readFileSync('d:/repo-janitor-data/benchmark/models/unseen-eval-2026-11-20.json','utf8')).cases
const flagged = new Set(labels.filter(c=>c.manual_review.flags.some(f=>f.startsWith('ambiguous'))).map(c=>c.id))
const acted = r => (r.verdict==='vulnerable' && !r.grounded) ? 'uncertain' : r.verdict
function agg(file) {
  const rows = readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  const s = {}
  for (const r of rows) { if (flagged.has(r.case)) continue
    const m = s[r.model] ??= {n:0,trusted:0,vF:0,vT:0,cO:0,cT:0,evid:0,halluc:0,errors:0}
    if (r.error){m.errors++;continue} m.n++
    if (acted(r)===r.expected) m.trusted++
    if (r.evidence>0){m.evid++; if(!r.grounded)m.halluc++}
    if (r.expected==='vulnerable'){m.vT++; if(r.verdict==='vulnerable')m.vF++} else {m.cT++; if(r.verdict==='clean')m.cO++}
  }
  return s
}
const [A='unseen-eval', B='unseen-eval-sinks'] = process.argv.slice(2)
console.log(`arms: ${A} -> ${B}`)
const base = agg(join(here,'.model-compare',A,'results-fast.jsonl'))
const sink = agg(join(here,'.model-compare',B,'results-fast.jsonl'))
const p = (a,b)=> b? Math.round(100*a/b) : 0
const d = v => (v>=0?'+':'')+v
console.log('\nA/B: sink reference block vs baseline (role models, non-ambiguous cases)\n')
console.log('model'.padEnd(26),'trusted     vulnRecall   hallu       spec')
for (const model of Object.keys(sink)) {
  const b=base[model], s=sink[model]; if(!b) continue
  const bt=p(b.trusted,b.n), st=p(s.trusted,s.n)
  const bv=p(b.vF,b.vT), sv=p(s.vF,s.vT)
  const bh=p(b.halluc,b.evid), sh=p(s.halluc,s.evid)
  const bc=p(b.cO,b.cT), sc=p(s.cO,s.cT)
  console.log(model.replace(':free','').padEnd(26),
    `${bt}->${st}% (${d(st-bt)})`.padEnd(13),
    `${bv}->${sv}% (${d(sv-bv)})`.padEnd(13),
    `${bh}->${sh}% (${d(sh-bh)})`.padEnd(12),
    `${bc}->${sc}% (${d(sc-bc)})`)
}
console.log('\n(left=baseline, right=with sink block. trusted/vulnRecall/spec up good, hallu down good.)')
