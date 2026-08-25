import fs from "node:fs";
import { db, ftsRebuild } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import {
  replaceHotspots,
  upsertDoc,
  writeHotspotsFile,
  type HotspotRow,
} from "@/lib/trackFiles";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const project = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!project) return fail("not found", 404);
  const b = await readJson<{ rows: HotspotRow[] }>(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  replaceHotspots(id, rows);
  const file = writeHotspotsFile(
    { path: String(project.path || ""), slug: String(project.slug), title: String(project.title) },
    rows
  );
  upsertDoc(id, "hotspots", `${project.slug} / hotspots`, file, fs.readFileSync(file, "utf8"));
  ftsRebuild();
  const saved = db()
    .prepare("SELECT * FROM hotspots WHERE project_id = ? ORDER BY sort_order, id")
    .all(id);
  return ok({ ok: true, file, hotspots: saved });
}
