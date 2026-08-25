import { fail, ok, readJson } from "@/lib/http";
import { loadMarket, loadTargets, saveTargets, slugOf, targetState, type Target } from "@/lib/market";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = loadTargets().map((t) => ({
    site: t.site,
    pid: t.pid,
    name: t.name,
    url: t.url,
    slug: t.slug,
    reward: t.reward,
    fee: t.fee,
    kyc: t.kyc,
    reports: t.reports,
    assets: (t.assets || []).length,
    repos: t.repos || [],
    state: targetState(t.slug),
  }));
  return ok({ count: rows.length, rows });
}

export async function POST(req: Request) {
  const b = await readJson<{ add?: string[]; drop?: string }>(req);
  const rows = loadTargets();

  if (b.drop) {
    const keep = rows.filter((r) => r.slug !== b.drop && `${r.site}:${r.pid}` !== b.drop);
    saveTargets(keep);
    return ok({ dropped: rows.length - keep.length });
  }

  const ids = b.add || [];
  if (!ids.length) return fail("нужны add[] вида site:pid или drop");
  const market = loadMarket();
  const have = new Set(rows.map((r) => `${r.site}:${r.pid}`));
  let added = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    const [site, pid] = id.split(":");
    const p = market.find((x) => x.site === site && x.pid === pid);
    if (!p) continue;
    // Формат строки — ровно тот, что пишет targets.py: файл общий.
    const row: Target = { ...p, slug: slugOf(p.name) };
    rows.push(row);
    have.add(id);
    added++;
  }
  saveTargets(rows);
  return ok({ added, count: rows.length });
}
