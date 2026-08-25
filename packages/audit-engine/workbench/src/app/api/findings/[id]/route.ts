import { db, ftsRebuild, qrun } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then((p) => {
    const row = db().prepare("SELECT * FROM findings WHERE id = ?").get(Number(p.id));
    if (!row) return fail("not found", 404);
    return ok(row);
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const b = await readJson<Record<string, unknown>>(req);
  const fields = ["title", "severity", "status", "body", "files", "project_id"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (f in b) {
      sets.push(`${f} = ?`);
      vals.push(b[f]);
    }
  }
  if (!sets.length) return fail("nothing");
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  qrun(`UPDATE findings SET ${sets.join(", ")} WHERE id = ?`, vals);
  ftsRebuild();
  return ok(db().prepare("SELECT * FROM findings WHERE id = ?").get(id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  db().prepare("DELETE FROM findings WHERE id = ?").run(Number(id));
  ftsRebuild();
  return ok({ ok: true });
}
