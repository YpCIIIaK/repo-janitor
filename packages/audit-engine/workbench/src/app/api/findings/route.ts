import { db, ftsRebuild, qall } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project");
  const status = url.searchParams.get("status");
  let sql = `SELECT f.*, p.slug AS project_slug, p.title AS project_title
             FROM findings f LEFT JOIN projects p ON p.id = f.project_id WHERE 1=1`;
  const args: unknown[] = [];
  if (project) {
    sql += " AND p.slug = ?";
    args.push(project);
  }
  if (status) {
    sql += " AND f.status = ?";
    args.push(status);
  }
  sql += " ORDER BY f.updated_at DESC";
  return ok(qall(sql, args));
}

export async function POST(req: Request) {
  const b = await readJson<{
    project_id?: number | null;
    title: string;
    severity?: string;
    status?: string;
    body?: string;
    files?: string;
  }>(req);
  if (!b.title) return fail("title обязателен");
  const r = db()
    .prepare(
      `INSERT INTO findings (project_id, title, severity, status, body, files)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(b.project_id ?? null, b.title, b.severity || "", b.status || "lead", b.body || "", b.files || "");
  ftsRebuild();
  return ok(db().prepare("SELECT * FROM findings WHERE id = ?").get(r.lastInsertRowid as number), 201);
}
