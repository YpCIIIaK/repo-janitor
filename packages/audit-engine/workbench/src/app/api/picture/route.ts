import { db } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const d = db();
  const reports = d
    .prepare(
      `SELECT r.id, r.program_slug, r.title, r.summary, r.payload, r.created_at, r.project_id,
        p.min_rep, p.max_bounty, p.paid, p.submissions, p.fee, p.languages
       FROM reports r
       LEFT JOIN programs p ON p.slug = r.program_slug
       ORDER BY r.id DESC`
    )
    .all() as Record<string, unknown>[];

  const parsed = reports.map((r) => {
    let payload: {
      gates?: { ok?: boolean; notes?: string };
      leads?: unknown[];
      hotspots?: unknown[];
      kill?: string[];
    } = {};
    try {
      payload = JSON.parse(String(r.payload || "{}"));
    } catch {
      payload = {};
    }
    const open = payload.gates?.ok !== false;
    return {
      id: r.id,
      slug: r.program_slug,
      title: r.title,
      summary: r.summary,
      open,
      gates_notes: payload.gates?.notes || "",
      leads_n: (payload.leads || []).length,
      hotspots_n: (payload.hotspots || []).length,
      min_rep: r.min_rep,
      max_bounty: r.max_bounty,
      paid: r.paid,
      submissions: r.submissions,
      fee: r.fee,
      languages: r.languages,
      project_id: r.project_id,
    };
  });

  const open = parsed.filter((x) => x.open);
  const closed = parsed.filter((x) => !x.open);
  const top = [...open]
    .filter((x) => x.leads_n > 0)
    .sort((a, b) => Number(b.max_bounty || 0) - Number(a.max_bounty || 0));
  const solidity = top.filter((x) => String(x.languages || "").includes("Solidity"));

  const leads = d
    .prepare(
      `SELECT i.id, i.report_id, i.title, i.severity, i.body, r.program_slug, r.title AS program
       FROM report_items i JOIN reports r ON r.id = i.report_id
       WHERE i.kind = 'lead' ORDER BY i.id DESC LIMIT 200`
    )
    .all();
  const hotspots = d
    .prepare(
      `SELECT i.id, i.report_id, i.title, i.severity, i.body, r.program_slug, r.title AS program
       FROM report_items i JOIN reports r ON r.id = i.report_id
       WHERE i.kind = 'hotspot' ORDER BY i.id DESC LIMIT 200`
    )
    .all();
  const findings = d
    .prepare(
      `SELECT f.*, p.slug AS project_slug, p.title AS project_title
       FROM findings f LEFT JOIN projects p ON p.id = f.project_id
       ORDER BY f.updated_at DESC LIMIT 120`
    )
    .all();
  const memory = d.prepare(`SELECT * FROM scanner_memory ORDER BY weight DESC, id DESC LIMIT 80`).all();
  const jobs = d.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all();

  return ok({
    jobs,
    stats: {
      reports: parsed.length,
      open: open.length,
      closed: closed.length,
      leads: leads.length,
      hotspots: hotspots.length,
      findings: findings.length,
      memory: memory.length,
    },
    top,
    topSolidity: solidity,
    skip: closed,
    leads,
    hotspots,
    findings,
    memory,
  });
}
