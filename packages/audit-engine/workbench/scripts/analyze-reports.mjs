import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("D:/auditscout/workbench/data/workbench.db");
db.exec("PRAGMA busy_timeout = 5000");
db.prepare(`UPDATE jobs SET status='queued', error='stopped by user' WHERE status='running'`).run();

const reports = db.prepare(`SELECT * FROM reports ORDER BY id`).all();
const out = reports.map((r) => {
  const p = JSON.parse(r.payload || "{}");
  const prog = db.prepare("SELECT min_rep,max_bounty,paid,submissions,fee,kyc,languages,types FROM programs WHERE slug=?").get(r.program_slug) || {};
  let langs = [];
  try { langs = JSON.parse(prog.languages || "[]"); } catch { langs = [prog.languages]; }
  const ev = p.gates?.ok === false ? 0 : (Number(prog.max_bounty) || 0);
  return {
    id: r.id,
    slug: r.program_slug,
    title: r.title.replace(/^\[smoke\]\s*/, ""),
    gates_ok: p.gates?.ok !== false,
    gates_notes: (p.gates?.notes || "").slice(0, 160),
    leads: (p.leads || []).length,
    hotspots: (p.hotspots || []).length,
    kill: (p.kill || []).slice(0, 4),
    lead_titles: (p.leads || []).map((l) => `${l.severity || "?"} ${l.p_dupe || ""} ${l.title}`),
    hotspot_titles: (p.hotspots || []).map((h) => `${h.code} ${h.severity} ${h.title}`),
    summary: (p.summary || r.summary || "").slice(0, 280),
    min_rep: prog.min_rep,
    max_bounty: prog.max_bounty,
    paid: prog.paid,
    submissions: prog.submissions,
    fee: prog.fee,
    langs: langs,
    ev,
  };
});

const open = out.filter((x) => x.gates_ok);
const closed = out.filter((x) => !x.gates_ok);
const hunt = open.filter((x) => x.leads > 0).sort((a, b) => (b.max_bounty || 0) - (a.max_bounty || 0));
const skip = [...closed, ...open.filter((x) => x.leads === 0)];

console.log(JSON.stringify({
  n: out.length,
  open: open.length,
  closed: closed.length,
  hunt: hunt.map((x) => ({
    id: x.id, slug: x.slug, title: x.title, max: x.max_bounty, paid: x.paid, subs: x.submissions,
    fee: x.fee, rep: x.min_rep, langs: x.langs, leads: x.leads, notes: x.gates_notes,
    lead_titles: x.lead_titles, hotspot_titles: x.hotspot_titles, summary: x.summary,
  })),
  skip: skip.map((x) => ({
    id: x.id, slug: x.slug, title: x.title, max: x.max_bounty, why: x.gates_ok ? "0 leads" : x.gates_notes || x.kill[0] || "gates red",
    kill: x.kill,
  })),
}, null, 2));
