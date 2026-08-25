import fs from "node:fs";
import path from "node:path";
import { db, ftsRebuild } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { upsertDoc, writeKillFile } from "@/lib/trackFiles";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const project = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | { path?: string; slug?: string }
    | undefined;
  if (!project) return fail("not found", 404);
  const doc = db()
    .prepare("SELECT body FROM documents WHERE project_id = ? AND kind = 'kill'")
    .get(id) as { body: string } | undefined;
  let body = doc?.body || "";
  if (!body && project.path) {
    try {
      body = fs.readFileSync(path.join(project.path, "KILL.md"), "utf8");
    } catch {
      body = "";
    }
  }
  return ok({ body });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  const project = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!project) return fail("not found", 404);
  const b = await readJson<{ body: string }>(req);
  const file = writeKillFile(
    { path: String(project.path || ""), slug: String(project.slug) },
    b.body || ""
  );
  upsertDoc(id, "kill", `${project.slug} / kill`, file, b.body || "");
  ftsRebuild();
  return ok({ ok: true, file });
}
