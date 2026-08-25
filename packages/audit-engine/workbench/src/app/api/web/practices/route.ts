import { ok } from "@/lib/http";
import { PRACTICES } from "@/lib/webPractices";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ practices: PRACTICES });
}
