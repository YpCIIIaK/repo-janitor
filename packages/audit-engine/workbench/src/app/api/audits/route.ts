import { qall } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const project = url.searchParams.get("project");
  let sql =
    "SELECT id, project_id, kind, title, source_path, length(body) AS bytes, updated_at FROM documents WHERE kind = 'audit'";
  const args: unknown[] = [];
  if (project) {
    sql += " AND project_id = (SELECT id FROM projects WHERE slug = ?)";
    args.push(project);
  }
  if (q) {
    sql += " AND (title LIKE ? OR body LIKE ?)";
    args.push(`%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY title LIMIT 400";
  return ok(qall(sql, args));
}
