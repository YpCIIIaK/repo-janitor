const ALLOW = [
  "hackenproof.com",
  "www.hackenproof.com",
  "github.com",
  "raw.githubusercontent.com",
  "docs.sui.io",
  "immunefi.com",
  "cantina.xyz",
  "docs.erc4337.io",
];

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return ALLOW.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

export function htmlToText(html: string, max = 24_000): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, max);
}

export async function fetchAllowed(url: string, signal?: AbortSignal): Promise<{ url: string; text: string; ok: boolean }> {
  if (!isAllowedUrl(url)) return { url, text: "", ok: false };
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "auditscout-workbench/0.2 (local research)" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    const raw = await r.text();
    const text = htmlToText(raw);
    return { url, text, ok: r.ok && text.length > 40 };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return { url, text: "", ok: false };
  }
}

export function githubReadmeUrls(repoUrl: string): string[] {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) return [];
  const org = m[1];
  const repo = m[2].replace(/\.git$/, "");
  return [
    `https://raw.githubusercontent.com/${org}/${repo}/HEAD/README.md`,
    `https://raw.githubusercontent.com/${org}/${repo}/main/README.md`,
    `https://raw.githubusercontent.com/${org}/${repo}/master/README.md`,
  ];
}

export function extractGithubUrls(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g;
  for (const m of text.match(re) || []) {
    const u = m.replace(/[.,);]+$/, "");
    if (!out.includes(u)) out.push(u);
    if (out.length >= 4) break;
  }
  return out;
}
