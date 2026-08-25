import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = db().prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
  if (!row) return fail("not found", 404);
  return ok(row);
}
