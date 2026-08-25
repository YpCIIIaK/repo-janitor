import { db, ftsRebuild, qrun } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { upsertDoc, writeNotesFile } from "@/lib/trackFiles";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then((p) => {
    const id = Number(p.id);
    const project = db().prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!project) return fail("not found", 404);
    const hotspots = db()
      .prepare("SELECT * FROM hotspots WHERE project_id = ? ORDER BY sort_order, id")
      .all(id);
    const findings = db()
      .prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY updated_at DESC")
      .all(id);
    const documents = db()
      .prepare(
        "SELECT id, kind, title, source_path, length(body) AS bytes, updated_at FROM documents WHERE project_id = ? ORDER BY kind, title"
      )
      .all(id);
    return ok({ project, hotspots, findings, documents });
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const b = await readJson<Record<string, unknown>>(req);
  const fields = ["title", "status", "platform", "program_url", "notes", "stopped_at", "min_rep", "max_bounty"] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of fields) {
    if (f in b) {
      sets.push(`${f} = ?`);
      vals.push(b[f]);
    }
  }
  if (!sets.length) return fail("nothing to update");
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  qrun(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, vals);
  const row = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
  if ("notes" in b && row) {
    const file = writeNotesFile(
      { path: String(row.path || ""), slug: String(row.slug), title: String(row.title) },
      String(b.notes)
    );
    upsertDoc(id, "notes", `${row.slug} / notes`, file, String(b.notes));
  }
  ftsRebuild();
  return ok(row);
}
