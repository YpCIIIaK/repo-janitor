import { ok } from "@/lib/http";
import { density, isSmartContract, isWebProgram, loadMarket, loadTargets, rank } from "@/lib/market";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const site = url.searchParams.get("site") || "";
  const onlySc = url.searchParams.get("sc") !== "0";
  const onlyWeb = url.searchParams.get("web") === "1";
  const onlyRepos = url.searchParams.get("repos") === "1";
  const noFee = url.searchParams.get("nofee") === "1";
  const limit = Number(url.searchParams.get("limit") || 60);

  const all = loadMarket();
  const chosen = new Set(loadTargets().map((t) => `${t.site}:${t.pid}`));
  let rows = all;
  if (site) rows = rows.filter((p) => p.site === site);
  if (onlyWeb) rows = rows.filter(isWebProgram);
  else if (onlySc) rows = rows.filter(isSmartContract);
  if (onlyRepos) rows = rows.filter((p) => p.repos.length > 0);
  if (noFee) rows = rows.filter((p) => p.fee === 0 && !p.kyc);
  if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.pid.toLowerCase().includes(q));

  const sites = [...new Set(all.map((p) => p.site))].sort();
  const total = rows.length;
  const out = [...rows]
    .sort(rank)
    .slice(0, limit)
    .map((p) => ({
      site: p.site,
      pid: p.pid,
      name: p.name,
      url: p.url,
      reward: p.reward,
      fee: p.fee,
      kyc: p.kyc,
      reports: p.reports,
      assets: p.assets.length,
      repos: p.repos.length,
      density: density(p),
      chosen: chosen.has(`${p.site}:${p.pid}`),
    }));
  return ok({ sites, total, all: all.length, rows: out });
}
