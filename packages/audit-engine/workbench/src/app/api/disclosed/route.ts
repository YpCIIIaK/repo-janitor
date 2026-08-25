import { qall } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sev = url.searchParams.get("severity") || "";
  let sql = "SELECT * FROM disclosed WHERE 1=1";
  const args: unknown[] = [];
  if (sev) {
    sql += " AND severity = ?";
    args.push(sev);
  }
  if (q) {
    sql += " AND (title LIKE ? OR program LIKE ? OR handle LIKE ?)";
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  sql += " ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, bounty DESC";
  const rows = qall(sql, args);
  return ok(rows);
}
