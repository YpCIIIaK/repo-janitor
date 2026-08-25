import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("D:/auditscout/workbench/data/workbench.db");
const jobs = db.prepare(`SELECT id, target, status, report_id, error FROM jobs WHERE id >= 28`).all();
const reps = db.prepare(`SELECT id, program_slug, length(payload) plen, substr(summary,1,80) s FROM reports ORDER BY id DESC LIMIT 8`).all();
console.log("jobs", jobs);
console.log("reports", reps);
const r = db.prepare(`SELECT id, program_slug, payload FROM reports WHERE id IN (26,27)`).all();
for (const x of r) {
  const p = JSON.parse(x.payload);
  console.log(x.id, x.program_slug, "hunted", p.hunted, "hs", (p.hotspots||[]).map(h=>h.code+" "+h.title));
}
