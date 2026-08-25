import { fail, ok, readJson } from "@/lib/http";
import { addCustomSite, addHost, addWebTargets, dropWebTarget, loadWebTargets } from "@/lib/webTargets";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = loadWebTargets().map((t) => ({
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
    hosts: t.hosts || [],
  }));
  return ok({ count: rows.length, rows });
}

export async function POST(req: Request) {
  const b = await readJson<{
    add?: string[];
    drop?: string;
    slug?: string;
    host?: string;
    custom?: { name?: string; url?: string };
  }>(req);
  if (b.drop) return ok({ dropped: dropWebTarget(b.drop) });
  if (b.custom?.url) {
    const r = addCustomSite(b.custom.name || "", b.custom.url);
    if ("error" in r && r.error) return fail(r.error);
    return ok(r);
  }
  if (b.slug && b.host) {
    const t = addHost(b.slug, b.host);
    if (!t) return fail("нет такой мишени");
    return ok({ hosts: t.hosts });
  }
  const ids = b.add || [];
  if (!ids.length) return fail("нужны add[] вида site:pid или custom.url");
  return ok(addWebTargets(ids));
}
