import fs from "node:fs";

import { loadMarket, slugOf, type Target, webHostsOf } from "@/lib/market";
import { webSiteDir, webTargetsPath } from "@/lib/webPaths";

export type WebTarget = Target & { hosts: string[] };

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadWebTargets(): WebTarget[] {
  return readJson<WebTarget[]>(webTargetsPath(), []).map((t) => ({
    ...t,
    assets: t.assets || [],
    repos: t.repos || [],
    tags: t.tags || [],
    hosts: t.hosts?.length ? t.hosts : webHostsOf(t),
  }));
}

export function saveWebTargets(rows: WebTarget[]) {
  fs.writeFileSync(webTargetsPath(), JSON.stringify(rows, null, 1), "utf8");
}

export function addCustomSite(name: string, url: string) {
  let host = "";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    if (u.protocol !== "https:") return { error: "только https" };
    host = u.hostname.toLowerCase();
  } catch {
    return { error: "не URL" };
  }
  if (!host.includes(".") || host === "localhost") return { error: "нужен публичный хост" };
  const rows = loadWebTargets();
  const slug = slugOf(name || host);
  if (rows.some((r) => r.slug === slug || r.hosts.includes(host))) {
    const t = rows.find((r) => r.slug === slug || r.hosts.includes(host));
    if (t && !t.hosts.includes(host)) {
      t.hosts.push(host);
      saveWebTargets(rows);
    }
    return { added: 0, count: rows.length, slug: t?.slug || slug, exists: true };
  }
  const page = url.startsWith("http") ? url : `https://${host}/`;
  rows.push({
    site: "custom",
    pid: slug,
    name: name.trim() || host,
    url: page,
    reward: 0,
    currency: "",
    fee: 0,
    kyc: false,
    reports: -1,
    assets: [{ name: host, type: "web", url: `https://${host}/` }],
    repos: [],
    tags: ["custom"],
    updated: "",
    slug,
    hosts: [host],
  });
  saveWebTargets(rows);
  return { added: 1, count: rows.length, slug };
}

export function addWebTargets(ids: string[]) {
  const market = loadMarket();
  const rows = loadWebTargets();
  const have = new Set(rows.map((r) => `${r.site}:${r.pid}`));
  let added = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    const [site, pid] = id.split(":");
    const p = market.find((x) => x.site === site && x.pid === pid);
    if (!p) continue;
    const hosts = webHostsOf(p);
    if (!hosts.length) {
      try {
        const h = new URL(p.url).hostname.toLowerCase();
        if (h.includes(".")) hosts.push(h);
      } catch {
        /* skip */
      }
    }
    rows.push({ ...p, slug: slugOf(p.name), hosts });
    have.add(id);
    added++;
  }
  saveWebTargets(rows);
  return { added, count: rows.length };
}

export function dropWebTarget(id: string) {
  const rows = loadWebTargets();
  const keep = rows.filter((r) => r.slug !== id && `${r.site}:${r.pid}` !== id);
  saveWebTargets(keep);
  return rows.length - keep.length;
}

export function getWebTarget(slug: string) {
  return loadWebTargets().find((t) => t.slug === slug);
}

export function addHost(slug: string, host: string) {
  const rows = loadWebTargets();
  const t = rows.find((r) => r.slug === slug);
  if (!t) return null;
  const h = host.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!h.includes(".")) return t;
  if (!t.hosts.includes(h)) t.hosts.push(h);
  saveWebTargets(rows);
  return t;
}

export function surfacePath(slug: string) {
  return `${webSiteDir(slug)}/surface.json`;
}
