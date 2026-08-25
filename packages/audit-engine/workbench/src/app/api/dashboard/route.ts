import { db, getSetting } from "@/lib/db";
import { importAll, importTracks } from "@/lib/import";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const d = db();
  const programCount = d.prepare("SELECT COUNT(*) AS n FROM programs").get() as { n: number };
  try {
    if (programCount.n === 0) importAll();
    else importTracks();
  } catch {
    /* first paint without index is ok */
  }
  const projects = d
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM findings f WHERE f.project_id = p.id) AS findings_count,
        (SELECT COUNT(*) FROM hotspots h WHERE h.project_id = p.id) AS hotspots_count
       FROM projects p ORDER BY
         CASE p.status WHEN 'active' THEN 0 WHEN 'watch' THEN 1 WHEN 'parked' THEN 2 ELSE 3 END,
         p.updated_at DESC`
    )
    .all();
  const findings = d.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number };
  const programs = d.prepare("SELECT COUNT(*) AS n FROM programs").get() as { n: number };
  const audits = d.prepare("SELECT COUNT(*) AS n FROM documents WHERE kind = 'audit'").get() as { n: number };
  const disclosed = d.prepare("SELECT COUNT(*) AS n FROM disclosed").get() as { n: number };
  const queued = d.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get() as { n: number };
  const reportsN = d.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  const recentReports = d
    .prepare(
      `SELECT id, title, summary, created_at,
        (SELECT COUNT(*) FROM report_items i WHERE i.report_id = reports.id AND i.kind='lead') AS leads_n
       FROM reports ORDER BY id DESC LIMIT 6`
    )
    .all();
  const current = getSetting("current_project", "aa-4337");
  const currentRow = d.prepare("SELECT * FROM projects WHERE slug = ?").get(current);
  const recentFindings = d
    .prepare(
      `SELECT f.*, p.slug AS project_slug, p.title AS project_title
       FROM findings f LEFT JOIN projects p ON p.id = f.project_id
       ORDER BY f.updated_at DESC LIMIT 8`
    )
    .all();
  return ok({
    stats: {
      projects: projects.length,
      findings: findings.n,
      programs: programs.n,
      audits: audits.n,
      disclosed: disclosed.n,
      queue: queued.n,
      reports: reportsN.n,
    },
    hp_reputation: Number(getSetting("hp_reputation", "80")),
    current,
    currentRow,
    projects,
    recentFindings,
    recentReports,
  });
}
