import { db } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { remember } from "@/lib/jsonImport";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db().prepare(`SELECT * FROM scanner_memory ORDER BY weight DESC, id DESC`).all();
  return ok(rows);
}

export async function POST(req: Request) {
  const b = await readJson<{ kind?: string; title?: string; body?: string; source?: string }>(req);
  if (!b.kind || !b.title) return fail("kind и title");
  remember(b.kind, b.title, b.body || "", b.source || "ui");
  return ok({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("id");
  db().prepare("DELETE FROM scanner_memory WHERE id = ?").run(id);
  return ok({ ok: true });
}
