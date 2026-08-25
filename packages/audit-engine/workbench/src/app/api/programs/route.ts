import { getSetting, qall } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const lang = url.searchParams.get("lang") || "";
  const eligible = url.searchParams.get("eligible") === "1";
  const ongoing = url.searchParams.get("ongoing") === "1";
  const solidity = url.searchParams.get("solidity") === "1";
  const maxRep = Number(url.searchParams.get("max_rep") || getSetting("hp_reputation", "80"));

  let sql = "SELECT * FROM programs WHERE 1=1";
  const args: unknown[] = [];
  if (eligible) {
    sql += " AND min_rep <= ?";
    args.push(maxRep);
  }
  if (ongoing) sql += " AND unending = 1 AND audit_program = 0 AND private = 0";
  if (solidity) sql += " AND languages LIKE '%Solidity%'";
  if (q) {
    sql += " AND (title LIKE ? OR slug LIKE ? OR languages LIKE ?)";
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (lang) {
    sql += " AND languages LIKE ?";
    args.push(`%${lang}%`);
  }
  sql += " ORDER BY (max_bounty IS NULL), max_bounty DESC, submissions ASC";
  const rows = qall(sql, args);
  return ok({ maxRep, count: rows.length, rows });
}
