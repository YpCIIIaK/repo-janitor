/* Свежесть данных для подвала боковой панели.

   Нарочно НЕ разбирает `market.json` (полтора мегабайта): берёт время
   правки файла и его размер. Ответ должен быть мгновенным — он рисуется на
   каждой странице. */
import fs from "node:fs";

import { ok } from "@/lib/http";
import { loadTargets, marketPath, targetsPath, targetState } from "@/lib/market";

export const dynamic = "force-dynamic";

export function GET() {
  let marketAt = "";
  let marketKb = 0;
  try {
    const st = fs.statSync(marketPath());
    marketAt = st.mtime.toISOString();
    marketKb = Math.round(st.size / 1024);
  } catch {
    /* снимка ещё нет */
  }
  let targets = 0;
  let scanned = 0;
  try {
    const rows = loadTargets();
    targets = rows.length;
    scanned = rows.filter((t) => targetState(t.slug).signals > 0).length;
  } catch {
    /* мишеней ещё нет */
  }
  return ok({ marketAt, marketKb, targets, scanned, targetsPath: targetsPath() });
}
