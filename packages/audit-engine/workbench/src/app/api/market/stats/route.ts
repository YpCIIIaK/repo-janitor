/* Цифры для графиков рынка: по площадкам, плотность против потолка, свежее.

   Всё считается из тех же двух файлов, что читает CLI: `market.json` и
   `market_prev.json` (его пишет `market.py --refresh`). Никакого своего
   состояния — иначе UI и консоль однажды разойдутся. */
import fs from "node:fs";
import path from "node:path";

import { ok } from "@/lib/http";
import { density, isSmartContract, isWebProgram, loadMarket, type Program } from "@/lib/market";
import { workspaceRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

function prevIndex(): Map<string, Program> | null {
  const file = path.join(workspaceRoot(), "data", "market_prev.json");
  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Program[];
    return new Map(rows.map((p) => [`${p.site}:${p.pid}`, p]));
  } catch {
    return null;
  }
}

function daysAgo(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 86400000);
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const onlySc = url.searchParams.get("sc") !== "0";
  const onlyWeb = url.searchParams.get("web") === "1";
  const all = loadMarket();
  const rows = onlyWeb ? all.filter(isWebProgram) : onlySc ? all.filter(isSmartContract) : all;

  const bySite = new Map<string, { n: number; sc: number; repos: number; pot: number }>();
  for (const p of all) {
    const e = bySite.get(p.site) || { n: 0, sc: 0, repos: 0, pot: 0 };
    e.n++;
    if (isSmartContract(p)) e.sc++;
    if (p.repos.length) e.repos++;
    e.pot = Math.max(e.pot, p.reward);
    bySite.set(p.site, e);
  }

  // Точки только там, где плотность ИЗВЕСТНА: у immunefi, hackerone, bugcrowd
  // и intigriti числа заявок нет вовсе, и рисовать их нулём было бы ложью.
  const dots = rows
    .map((p) => ({ p, d: density(p) }))
    .filter((x) => x.d !== null && x.d! > 0 && x.p.reward > 0)
    .map((x) => ({
      label: x.p.name,
      x: x.d as number,
      y: x.p.reward,
      group: x.p.site,
      extra: `${x.p.assets.length} активов · ${x.p.reports} заявок${x.p.fee ? ` · комиссия ${x.p.fee}$` : ""}`,
    }));

  const prev = prevIndex();
  const fresh = prev
    ? rows
        .filter((p) => !prev.has(`${p.site}:${p.pid}`))
        .sort((a, b) => b.reward - a.reward)
        .slice(0, 20)
        .map((p) => ({ site: p.site, pid: p.pid, name: p.name, url: p.url, reward: p.reward, assets: p.assets.length }))
    : [];

  const updated = rows
    .map((p) => ({ p, age: daysAgo(p.updated) }))
    .filter((x) => x.age !== null && x.age! <= 30)
    .sort((a, b) => (a.age as number) - (b.age as number))
    .slice(0, 20)
    .map((x) => ({
      site: x.p.site,
      pid: x.p.pid,
      name: x.p.name,
      url: x.p.url,
      reward: x.p.reward,
      age: x.age as number,
      repos: x.p.repos.length,
    }));

  return ok({
    total: all.length,
    scope: rows.length,
    hasPrev: prev !== null,
    sites: [...bySite.entries()]
      .map(([site, e]) => ({ site, ...e }))
      .sort((a, b) => b.n - a.n),
    dots,
    fresh,
    updated,
  });
}
