import { fail, ok } from "@/lib/http";
import { applyReport } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return ok(applyReport(Number(id)));
  } catch (e) {
    return fail(String(e), 400);
  }
}
