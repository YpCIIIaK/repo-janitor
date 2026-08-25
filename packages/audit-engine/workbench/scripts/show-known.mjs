import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("D:/auditscout/workbench/data/workbench.db");
const rows = db.prepare(`SELECT id, program_slug, title, summary, payload FROM reports WHERE program_slug IN ('hyperbridge-protocol','account-abstraction-bugs','bitunix-web') ORDER BY id DESC LIMIT 6`).all();
for (const r of rows) {
  const p = JSON.parse(r.payload || "{}");
  console.log(JSON.stringify({
    id: r.id,
    slug: r.program_slug,
    hunted: p.hunted,
    summary: (p.summary || r.summary || "").slice(0, 280),
    hotspots: (p.hotspots || []).map((h) => `${h.code} ${h.title} [${h.severity}]`),
    leads: (p.leads || []).map((l) => l.title),
    kill: (p.kill || []).slice(0, 6),
  }, null, 2));
  console.log("---");
}
