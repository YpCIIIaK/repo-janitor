import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("D:/auditscout/workbench/data/workbench.db");
db.exec("PRAGMA busy_timeout = 5000");

const jobs = db.prepare(`SELECT status, COUNT(*) n FROM jobs GROUP BY status`).all();
const reports = db.prepare(`SELECT * FROM reports ORDER BY id`).all();
const items = db.prepare(`SELECT * FROM report_items ORDER BY report_id, kind, id`).all();
const programs = db.prepare(`SELECT slug, title, min_rep, max_bounty, paid, submissions, fee, kyc, languages, types, status FROM programs`).all();
const bySlug = Object.fromEntries(programs.map((p) => [p.slug, p]));

const rows = reports.map((r) => {
  const payload = JSON.parse(r.payload || "{}");
  const its = items.filter((i) => i.report_id === r.id);
  const p = bySlug[r.program_slug] || {};
  return {
    id: r.id,
    slug: r.program_slug,
    title: r.title,
    summary: r.summary,
    gates: payload.gates || {},
    payouts: payload.payouts || "",
    scope: payload.scope || [],
    oos: payload.oos || [],
    kill: payload.kill || [],
    hotspots: (payload.hotspots || []).map((h) => ({
      code: h.code,
      title: h.title,
      severity: h.severity,
      why: h.why,
    })),
    leads: (payload.leads || []).map((l) => ({
      title: l.title,
      severity: l.severity,
      p_dupe: l.p_dupe,
      hypothesis: l.hypothesis,
      why_not_oos: l.why_not_oos,
    })),
    parse_error: Boolean(payload.parse_error),
    min_rep: p.min_rep,
    max_bounty: p.max_bounty,
    paid: p.paid,
    submissions: p.submissions,
    fee: p.fee,
    kyc: p.kyc,
    languages: p.languages,
    types: p.types,
    item_counts: {
      lead: its.filter((i) => i.kind === "lead").length,
      hotspot: its.filter((i) => i.kind === "hotspot").length,
      kill: its.filter((i) => i.kind === "kill").length,
    },
  };
});

writeFileSync("D:/auditscout/workbench/data/scan-dump.json", JSON.stringify({ jobs, n: rows.length, rows }, null, 2));
console.log("reports", rows.length, "jobs", JSON.stringify(jobs));
