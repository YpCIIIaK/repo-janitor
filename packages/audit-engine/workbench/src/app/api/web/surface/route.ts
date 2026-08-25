import fs from "node:fs";

import { fail, ok, readJson } from "@/lib/http";
import { analyzeSurface, tally } from "@/lib/webSurface";
import { safeGet, ScopeFetchError } from "@/lib/webSafeFetch";
import { getWebTarget, surfacePath } from "@/lib/webTargets";

export const dynamic = "force-dynamic";

const WELL_KNOWN = ["/.well-known/security.txt", "/robots.txt"];

export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!slug) return fail("slug");
  try {
    return ok(JSON.parse(fs.readFileSync(surfacePath(slug), "utf8")));
  } catch {
    return ok({ slug, probes: [] });
  }
}

export async function POST(req: Request) {
  const b = await readJson<{ slug: string; url?: string }>(req);
  const t = getWebTarget(b.slug);
  if (!t) return fail("сначала добавь сайт в /web/sites");
  const allow = t.hosts;
  if (!allow.length) return fail("нет хостов в скоупе — допиши хост вручную");

  let start = b.url || "";
  if (!start) {
    const first = allow[0];
    start = `https://${first}/`;
  }

  const probes: Record<string, unknown>[] = [];
  try {
    const page = await safeGet(start, allow);
    const findings = analyzeSurface(page);
    probes.push({
      kind: "page",
      url: page.finalUrl,
      status: page.status,
      findings,
      tally: tally(findings),
    });
    const origin = new URL(page.finalUrl).origin;
    for (const path of WELL_KNOWN) {
      try {
        const extra = await safeGet(origin + path, allow);
        probes.push({
          kind: path,
          url: extra.finalUrl,
          status: extra.status,
          snippet: extra.body.slice(0, 800),
          findings: extra.status === 200 && extra.body.trim()
            ? [{
                id: path,
                cls: "policy",
                severity: "info",
                title: path,
                question: path.includes("security")
                  ? "Куда слать отчёт по этому файлу?"
                  : "Что robots.txt просит не индексировать — это скоуп или подсказка?",
                evidence: extra.body.slice(0, 240),
              }]
            : [],
        });
      } catch {
        /* путь может не существовать */
      }
    }
  } catch (e) {
    const msg = e instanceof ScopeFetchError ? e.message : "запрос не удался";
    return fail(msg);
  }

  const report = {
    slug: t.slug,
    name: t.name,
    at: new Date().toISOString(),
    allow,
    note: "Только GET по скоупу. Нет полезных нагрузок, нет перебора, нет чужих аккаунтов.",
    probes,
  };
  fs.writeFileSync(surfacePath(t.slug), JSON.stringify(report, null, 1), "utf8");
  return ok(report);
}
