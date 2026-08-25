import fs from "node:fs";
import path from "node:path";

import { ok } from "@/lib/http";
import { isWebProgram, loadMarket } from "@/lib/market";
import { webFindingsPath, webRoot } from "@/lib/webPaths";
import { loadWebTargets } from "@/lib/webTargets";
import { tally, type WebFinding } from "@/lib/webSurface";

export const dynamic = "force-dynamic";

export function GET() {
  const market = loadMarket();
  const web = market.filter(isWebProgram);
  const scOnly = market.length - web.length;
  const picked = loadWebTargets();

  const bySite: Record<string, number> = {};
  for (const p of web) bySite[p.site] = (bySite[p.site] || 0) + 1;

  const findings: WebFinding[] = [];
  const items: {
    kind: "signal" | "report";
    slug: string;
    name: string;
    id: string;
    title: string;
    cls: string;
    severity?: string;
    question?: string;
    at?: string;
    href: string;
  }[] = [];
  const sitesDir = path.join(webRoot(), "sites");
  const names = new Map(picked.map((p) => [p.slug, p.name]));
  try {
    for (const slug of fs.readdirSync(sitesDir)) {
      const f = path.join(sitesDir, slug, "surface.json");
      if (!fs.existsSync(f)) continue;
      const rep = JSON.parse(fs.readFileSync(f, "utf8")) as {
        at?: string;
        name?: string;
        probes?: { findings?: WebFinding[] }[];
      };
      const name = names.get(slug) || rep.name || slug;
      for (const p of rep.probes || []) {
        for (const x of p.findings || []) {
          findings.push(x);
          items.push({
            kind: "signal",
            slug,
            name,
            id: x.id,
            title: x.title,
            cls: x.cls,
            severity: x.severity,
            question: x.question,
            at: rep.at,
            href: `/web/report?slug=${encodeURIComponent(slug)}&hit=${encodeURIComponent(x.id)}`,
          });
        }
      }
    }
  } catch {
    /* ещё нет прогонов */
  }
  try {
    const reports = JSON.parse(fs.readFileSync(webFindingsPath(), "utf8")) as {
      id: string;
      slug: string;
      title: string;
      cls?: string;
      at?: string;
      name?: string;
    }[];
    for (const r of reports) {
      items.unshift({
        kind: "report",
        slug: r.slug,
        name: names.get(r.slug) || r.name || r.slug,
        id: r.id,
        title: r.title,
        cls: r.cls || "report",
        at: r.at,
        href: `/web/report?id=${encodeURIComponent(r.id)}`,
      });
    }
  } catch {
    /* нет черновиков */
  }

  const t = tally(findings);
  return ok({
    marketAll: market.length,
    marketWeb: web.length,
    marketChain: scOnly,
    picked: picked.length,
    hosts: picked.reduce((n, r) => n + r.hosts.length, 0),
    bySite: Object.entries(bySite)
      .map(([site, n]) => ({ site, n }))
      .sort((a, b) => b.n - a.n),
    findings: t,
    items,
  });
}
