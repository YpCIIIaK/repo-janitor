import dns from "node:dns/promises";
import net from "node:net";

/** GET только https, только хосты из скоупа, без частных адресов. */
export class ScopeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeFetchError";
  }
}

function isBlockedIp(ip: string) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
  }
  if (net.isIP(ip) === 6) {
    const n = ip.toLowerCase();
    if (n === "::1" || n === "::") return true;
    if (n.startsWith("fe80:") || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("::ffff:")) return true;
  }
  return false;
}

export function hostAllowed(hostname: string, allow: string[]) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  return allow.some((raw) => {
    const a = raw.toLowerCase().replace(/^\*\./, "");
    return h === a || h.endsWith("." + a);
  });
}

export async function assertScopeUrl(raw: string, allow: string[]): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ScopeFetchError("не URL");
  }
  if (u.protocol !== "https:") throw new ScopeFetchError("только https");
  if (u.username || u.password) throw new ScopeFetchError("URL с учётными данными запрещён");
  if (u.port && u.port !== "443") throw new ScopeFetchError("только порт 443");
  if (!hostAllowed(u.hostname, allow)) throw new ScopeFetchError("хост вне скоупа");
  const addrs = await dns.lookup(u.hostname, { all: true, verbatim: true });
  if (!addrs.length) throw new ScopeFetchError("хост не резолвится");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new ScopeFetchError("частный или метаданные-IP");
  }
  return u;
}

export type SafeGet = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
};

const UA = "auditscout-web/0.1 (authorized-scope research; GET only; no exploit)";
const MAX_BODY = 400_000;
const MAX_HOPS = 4;

function headerMap(h: Headers) {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export async function safeGet(raw: string, allow: string[], hops = 0): Promise<SafeGet> {
  return safeRequest({ url: raw, allow, method: "GET", hops });
}

export async function safeRequest(opts: {
  url: string;
  allow: string[];
  method?: "GET" | "POST";
  form?: Record<string, string>;
  hops?: number;
}): Promise<SafeGet> {
  const hops = opts.hops || 0;
  if (hops > MAX_HOPS) throw new ScopeFetchError("слишком много редиректов");
  const method = opts.method || "GET";
  const u = await assertScopeUrl(opts.url, opts.allow);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
  };
  let body: string | undefined;
  if (method === "POST") {
    const form = opts.form || {};
    for (const [k, v] of Object.entries(form)) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,40}$/.test(k)) throw new ScopeFetchError("имя поля не из безопасного алфавита");
      if (!/^[A-Za-z0-9_-]{4,48}$/.test(v)) throw new ScopeFetchError("значение не маркер, а полезная нагрузка");
    }
    body = new URLSearchParams(form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const r = await fetch(u, {
    method,
    redirect: "manual",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const loc = r.headers.get("location");
  if (r.status >= 300 && r.status < 400 && loc) {
    const next = new URL(loc, u).toString();
    return safeRequest({ ...opts, url: next, hops: hops + 1, method: "GET", form: undefined });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.subarray(0, MAX_BODY).toString("utf8");
  return { url: opts.url, finalUrl: r.url || u.toString(), status: r.status, headers: headerMap(r.headers), body: text };
}
