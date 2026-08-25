import fs from "node:fs";
import path from "node:path";

import { fail, ok, readJson } from "@/lib/http";
import { checkVerdict, findCanary, isSafeParamName, makeCanary } from "@/lib/webCanary";
import { ScopeFetchError, safeRequest } from "@/lib/webSafeFetch";
import { webSiteDir } from "@/lib/webPaths";
import { getWebTarget } from "@/lib/webTargets";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!slug) return fail("slug");
  const file = path.join(webSiteDir(slug), "checks.json");
  try {
    return ok(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return ok({ slug, checks: [] });
  }
}

export async function POST(req: Request) {
  const b = await readJson<{
    slug: string;
    url: string;
    method?: "GET" | "POST";
    param: string;
  }>(req);
  const t = getWebTarget(b.slug);
  if (!t) return fail("сначала сайт в /web/sites");
  if (!b.url) return fail("url");
  if (!isSafeParamName(b.param || "")) return fail("имя параметра: латиница, цифры, _ . -");
  if (/[<>'"`\\;]|--|%3c|%3e|%27|%22/i.test(b.url + b.param)) {
    return fail("в URL есть символы полезной нагрузки — оставь чистый адрес, маркер подставит сервер");
  }
  const method = b.method === "POST" ? "POST" : "GET";
  const canary = makeCanary();
  let target = b.url;
  let form: Record<string, string> | undefined;
  try {
    const u = new URL(b.url);
    if (method === "GET") {
      u.searchParams.set(b.param, canary);
      target = u.toString();
    } else {
      form = { [b.param]: canary };
    }
    const page = await safeRequest({ url: target, allow: t.hosts, method, form });
    const reflection = findCanary(canary, page.body, page.headers, page.finalUrl);
    const verdict = checkVerdict(reflection);
    const row = {
      at: new Date().toISOString(),
      slug: t.slug,
      method,
      param: b.param,
      canary,
      url: page.finalUrl,
      status: page.status,
      reflection,
      verdict,
    };
    const file = path.join(webSiteDir(t.slug), "checks.json");
    let prev: { checks: unknown[] } = { checks: [] };
    try {
      prev = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      prev = { checks: [] };
    }
    prev.checks = [row, ...(prev.checks || [])].slice(0, 80);
    fs.writeFileSync(file, JSON.stringify(prev, null, 1), "utf8");
    return ok(row);
  } catch (e) {
    const msg = e instanceof ScopeFetchError ? e.message : "запрос не удался";
    return fail(msg);
  }
}
