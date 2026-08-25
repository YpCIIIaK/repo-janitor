import fs from "node:fs";

import { fail, ok, readJson } from "@/lib/http";
import { webFindingsPath } from "@/lib/webPaths";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  slug: string;
  cls: string;
  title: string;
  status: "lead" | "report" | "kill";
  note: string;
  at: string;
};

function load(): Row[] {
  try {
    return JSON.parse(fs.readFileSync(webFindingsPath(), "utf8")) as Row[];
  } catch {
    return [];
  }
}

function save(rows: Row[]) {
  fs.writeFileSync(webFindingsPath(), JSON.stringify(rows, null, 1), "utf8");
}

export function GET() {
  return ok({ rows: load() });
}

export async function POST(req: Request) {
  const b = await readJson<Partial<Row> & { drop?: string }>(req);
  const rows = load();
  if (b.drop) {
    const keep = rows.filter((r) => r.id !== b.drop);
    save(keep);
    return ok({ rows: keep });
  }
  if (!b.slug || !b.title) return fail("slug и title");
  const row: Row = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    slug: b.slug,
    cls: b.cls || "misc",
    title: b.title,
    status: b.status === "report" || b.status === "kill" ? b.status : "lead",
    note: b.note || "",
    at: new Date().toISOString(),
  };
  rows.unshift(row);
  save(rows);
  return ok({ row, rows });
}
