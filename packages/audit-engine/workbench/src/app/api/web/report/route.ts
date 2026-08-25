import fs from "node:fs";
import path from "node:path";

import { fail, ok, readJson } from "@/lib/http";
import { draftReport, draftSurfaceReport, type Reflection } from "@/lib/webCanary";
import { webFindingsPath, webSiteDir } from "@/lib/webPaths";
import { getWebTarget } from "@/lib/webTargets";
import type { WebFinding } from "@/lib/webSurface";

export const dynamic = "force-dynamic";

function saveDraft(t: { slug: string; name: string }, title: string, cls: string, md: string) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const file = path.join(webSiteDir(t.slug), `report-${id}.md`);
  fs.writeFileSync(file, md, "utf8");
  let findings: Record<string, unknown>[] = [];
  try {
    findings = JSON.parse(fs.readFileSync(webFindingsPath(), "utf8"));
  } catch {
    findings = [];
  }
  findings.unshift({
    id,
    slug: t.slug,
    name: t.name,
    cls,
    title,
    status: "report",
    note: md.slice(0, 400),
    draft: file,
    at: new Date().toISOString(),
  });
  fs.writeFileSync(webFindingsPath(), JSON.stringify(findings, null, 1), "utf8");
  return { id, file, md };
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const slug = url.searchParams.get("slug") || "";
  const hit = url.searchParams.get("hit") || "";

  if (id) {
    let findings: { id: string; slug: string; title?: string; cls?: string; draft?: string; name?: string }[] = [];
    try {
      findings = JSON.parse(fs.readFileSync(webFindingsPath(), "utf8"));
    } catch {
      return fail("нет отчётов", 404);
    }
    const row = findings.find((x) => x.id === id);
    if (!row?.draft) return fail("отчёт не найден", 404);
    try {
      return ok({
        id,
        slug: row.slug,
        title: row.title,
        cls: row.cls,
        md: fs.readFileSync(row.draft, "utf8"),
        file: row.draft,
      });
    } catch {
      return fail("файл пропал", 404);
    }
  }

  if (slug && hit) {
    const t = getWebTarget(slug);
    try {
      const rep = JSON.parse(fs.readFileSync(path.join(webSiteDir(slug), "surface.json"), "utf8")) as {
        probes?: { url?: string; findings?: WebFinding[] }[];
      };
      for (const p of rep.probes || []) {
        const f = (p.findings || []).find((x) => x.id === hit);
        if (f) {
          return ok({
            slug,
            hit,
            name: t?.name,
            url: p.url,
            finding: f,
            md: t
              ? draftSurfaceReport({
                  program: t.name,
                  programUrl: t.url,
                  title: f.title,
                  cls: f.cls,
                  url: p.url || t.url,
                  question: f.question,
                  evidence: f.evidence,
                  severity: f.severity,
                })
              : "",
          });
        }
      }
    } catch {
      /* fall through */
    }
    return fail("находка не найдена", 404);
  }

  return fail("нужен id или slug+hit");
}

export async function POST(req: Request) {
  const b = await readJson<{
    slug: string;
    title: string;
    cls?: string;
    url?: string;
    kind?: "marker" | "surface";
    param?: string;
    canary?: string;
    status?: number;
    reflection?: Reflection;
    verdict?: string;
    extra?: string;
    question?: string;
    evidence?: string;
    severity?: string;
  }>(req);
  const t = getWebTarget(b.slug);
  if (!t) return fail("нет сайта");

  if (b.kind === "surface" || (b.question && b.evidence && !b.canary)) {
    if (!b.title) return fail("title");
    const md = draftSurfaceReport({
      program: t.name,
      programUrl: t.url,
      title: b.title,
      cls: b.cls || "surface",
      url: b.url || t.url,
      question: b.question || "",
      evidence: b.evidence || "",
      severity: b.severity,
    });
    return ok({ ...saveDraft(t, b.title, b.cls || "surface", md), programUrl: t.url });
  }

  if (!b.title || !b.url || !b.param || !b.canary || !b.reflection) return fail("не хватает полей проверки");
  const md = draftReport({
    program: t.name,
    programUrl: t.url,
    title: b.title,
    cls: b.cls || "reflection",
    url: b.url,
    param: b.param,
    canary: b.canary,
    status: b.status || 0,
    reflection: b.reflection,
    verdict: b.verdict || "",
    extra: b.extra,
  });
  return ok({ ...saveDraft(t, b.title, b.cls || "reflection", md), programUrl: t.url });
}
