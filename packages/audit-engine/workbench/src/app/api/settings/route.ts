import { db, getSetting, setSetting } from "@/lib/db";
import { workspaceRoot } from "@/lib/paths";
import { ok, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  const all = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of all) map[r.key] = r.value;
  const hasKey = Boolean(process.env.OPENROUTER_API_KEY || map.openrouter_key);
  delete map.openrouter_key;
  return ok({
    ...map,
    hp_reputation: map.hp_reputation || "80",
    or_model: map.or_model || "nvidia/nemotron-3.5-lightning:free",
    workspace: workspaceRoot(),
    openrouter_configured: hasKey,
  });
}

export async function POST(req: Request) {
  const b = await readJson<Record<string, string>>(req);
  for (const [k, v] of Object.entries(b)) {
    if (k === "workspace" || k === "openrouter_configured") continue;
    if (k === "openrouter_key" && !String(v).trim()) continue;
    setSetting(k, String(v));
  }
  return ok({ ok: true, hp_reputation: getSetting("hp_reputation", "80") });
}
