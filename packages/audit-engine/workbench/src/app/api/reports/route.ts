import { db } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db()
    .prepare(
      `SELECT id, job_id, project_id, program_slug, title, model, summary, created_at,
        (SELECT COUNT(*) FROM report_items i WHERE i.report_id = reports.id AND i.kind='lead') AS leads_n,
        (SELECT COUNT(*) FROM report_items i WHERE i.report_id = reports.id AND i.kind='hotspot') AS hotspots_n,
        (SELECT COUNT(*) FROM report_items i WHERE i.report_id = reports.id AND i.kind='kill') AS kill_n
       FROM reports ORDER BY id DESC LIMIT 80`
    )
    .all();
  return ok(rows);
}
