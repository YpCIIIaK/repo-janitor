/* Память шлюза по мишени: рабочее состояние охоты. Читает
   data/bounty/<slug>/gate_memory.json (его пишет Python gatemem.py) и делит на
   ОТКРЫТЫЕ лиды (что ещё копать) и ЗАКРЫТЫЕ (killcheck/model/рука, с причиной).
   Сюда сходятся результаты всех новых шагов: killcheck-kill, bypass-флаг
   callgraph (в причине), вердикты judge. Только чтение файла. */
import fs from "node:fs";
import path from "node:path";

import { fail, ok } from "@/lib/http";
import { bountyRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

type Entry = { key: string; verdict?: string; reason?: string; source?: string; count?: number };

export function GET(req: Request) {
  const slug = (new URL(req.url).searchParams.get("slug") || "").trim();
  if (!slug) return fail("нужен slug");
  const file = path.join(bountyRoot(), slug, "gate_memory.json");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return ok({ slug, leads: [], cleans: [], exists: false });
  }
  let data: Record<string, Entry> = {};
  try {
    data = JSON.parse(raw);
  } catch {
    return ok({ slug, leads: [], cleans: [], exists: true, parseError: true });
  }
  const rows = Object.values(data);
  const leads = rows
    .filter((e) => e.verdict === "lead")
    .map((e) => ({ key: e.key, reason: e.reason || "", count: e.count || 1 }));
  const cleans = rows
    .filter((e) => e.verdict === "clean")
    .map((e) => ({ key: e.key, reason: e.reason || "", source: e.source || "", count: e.count || 1 }))
    // механические (killcheck) вниз, суждения (model/manual) вверх — их читать
    .sort((a, b) => (a.source === "killcheck" ? 1 : 0) - (b.source === "killcheck" ? 1 : 0));
  return ok({ slug, leads, cleans, exists: true });
}
