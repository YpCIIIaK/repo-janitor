import { db } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const report = db().prepare("SELECT * FROM reports WHERE id = ?").get(Number(id));
  if (!report) return fail("not found", 404);
  const items = db().prepare("SELECT * FROM report_items WHERE report_id = ? ORDER BY kind, id").all(Number(id));
  return ok({ report, items });
}
