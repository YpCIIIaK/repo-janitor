import { qall } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  let sql = "SELECT id, project_id, kind, title, source_path, length(body) AS bytes FROM documents WHERE 1=1";
  const args: unknown[] = [];
  if (kind) {
    sql += " AND kind = ?";
    args.push(kind);
  }
  sql += " ORDER BY title LIMIT 200";
  return ok(qall(sql, args));
}
