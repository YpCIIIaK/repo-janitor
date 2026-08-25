import { importAll } from "@/lib/import";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function POST() {
  try {
    return ok(importAll());
  } catch (e) {
    return fail(String(e), 500);
  }
}
