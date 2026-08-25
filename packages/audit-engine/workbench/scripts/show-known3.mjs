import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("D:/auditscout/workbench/data/workbench.db");
for (const id of [28, 29, 30]) {
  const r = db.prepare("SELECT id, program_slug, summary, payload FROM reports WHERE id=?").get(id);
  if (!r) { console.log("missing", id); continue; }
  const p = JSON.parse(r.payload || "{}");
  console.log(JSON.stringify({
    id: r.id,
    slug: r.program_slug,
    hunted: p.hunted,
    summary: (p.summary || r.summary || "").slice(0, 360),
    hotspots: (p.hotspots || []).map((h) => `${h.code} ${h.title} [${h.severity}]`),
    leads: (p.leads || []).map((l) => l.title),
    kill: (p.kill || []).slice(0, 8),
  }, null, 2));
  console.log("---");
}
