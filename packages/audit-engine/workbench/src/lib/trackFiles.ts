import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { bountyRoot } from "./paths";

export type HotspotRow = {
  id?: number;
  code: string;
  title: string;
  verdict: string;
  body?: string;
  sort_order?: number;
};

function trackDir(project: { path?: string; slug?: string }): string {
  if (project.path && fs.existsSync(project.path as string)) return project.path as string;
  return path.join(bountyRoot(), String(project.slug || ""));
}

export function writeNotesFile(project: { path?: string; slug?: string; title?: string }, notes: string) {
  const dir = trackDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "NOTES.md");
  fs.writeFileSync(p, notes, "utf8");
  return p;
}

export function writeKillFile(project: { path?: string; slug?: string }, kill: string) {
  const dir = trackDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "KILL.md");
  fs.writeFileSync(p, kill, "utf8");
  return p;
}

export function writeHotspotsFile(
  project: { path?: string; slug?: string; title?: string },
  rows: HotspotRow[]
) {
  const dir = trackDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `# HOTSPOTS — ${project.title || project.slug}`,
    "",
    "| ID | Surface | Почему |",
    "|----|---------|--------|",
  ];
  for (const r of rows) {
    const id = (r.code || "").replace(/\|/g, "/");
    const title = (r.title || "").replace(/\|/g, "/");
    const verdict = (r.verdict || r.body || "").replace(/\|/g, "/");
    lines.push(`| ${id} | ${title} | ${verdict} |`);
  }
  if (!rows.length) lines.push("|  |  |  |");
  lines.push("", "Стоп-лосс: 3 CLEAN Crit/High или ~8–12ч.", "");
  const p = path.join(dir, "HOTSPOTS.md");
  fs.writeFileSync(p, lines.join("\n"), "utf8");
  return p;
}

export function upsertDoc(projectId: number, kind: string, title: string, sourcePath: string, body: string) {
  const existing = db()
    .prepare("SELECT id FROM documents WHERE source_path = ?")
    .get(sourcePath) as { id: number } | undefined;
  if (existing) {
    db()
      .prepare("UPDATE documents SET title=?, body=?, kind=?, project_id=?, updated_at=datetime('now') WHERE id=?")
      .run(title, body, kind, projectId, existing.id);
  } else {
    db()
      .prepare("INSERT INTO documents (project_id, kind, title, source_path, body) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, kind, title, sourcePath, body);
  }
}

export function replaceHotspots(projectId: number, rows: HotspotRow[]) {
  db().prepare("DELETE FROM hotspots WHERE project_id = ?").run(projectId);
  const ins = db().prepare(
    "INSERT INTO hotspots (project_id, code, title, verdict, body, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  );
  rows.forEach((r, i) => {
    const code = (r.code || `X${i + 1}`).trim();
    const title = (r.title || "").trim();
    const verdict = (r.verdict || r.body || "").trim();
    ins.run(projectId, code, title, verdict, verdict, i);
  });
}

export const WEB_HOTSPOT_TEMPLATE: HotspotRow[] = [
  { code: "W1", title: "Auth / session", verdict: "угон сессии, cookie, JWT, reset" },
  { code: "W2", title: "IDOR ордера / баланс", verdict: "чужой user id в API" },
  { code: "W3", title: "Вывод / internal transfer", verdict: "без 2FA / смена адреса" },
  { code: "W4", title: "API без проверки user", verdict: "IDOR на KYC/карточки/ключи" },
  { code: "W5", title: "XSS → takeover", verdict: "stored в тикетах/чате/профиле" },
];

const HP_ALIAS: Record<string, string> = {
  "hyperbridge-protocol": "hyperbridge",
  "account-abstraction-bugs": "aa-4337",
  "bitunix-web": "bitunix",
};

function readCap(p: string, max: number): string {
  try {
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8").slice(0, max);
  } catch {
    return "";
  }
}

export type LocalHunt = {
  folder: string;
  dir: string;
  notes: string;
  hotspots: string;
  kill: string;
};

export function parseHotspotMd(md: string): { code: string; title: string; why: string; severity: string }[] {
  const out: { code: string; title: string; why: string; severity: string }[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 3) continue;
    if (/^-+$/.test(cols[0].replace(/:/g, "")) || /^id$/i.test(cols[0])) continue;
    const verdict = cols.slice(2).join(" · ");
    let severity = "High";
    if (/CLEAN/i.test(verdict)) severity = "CLEAN";
    else if (/Critical|Crit/i.test(verdict)) severity = "Critical";
    else if (/LEAD/i.test(verdict)) severity = "LEAD";
    out.push({ code: cols[0], title: cols[1] || cols[0], why: verdict, severity });
  }
  return out;
}

export function parseKillMd(md: string): string[] {
  return md
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.length > 12 && !l.startsWith("#") && !l.startsWith("|"))
    .slice(0, 14);
}

export function loadLocalHunt(hpSlug: string): LocalHunt | null {
  const root = bountyRoot();
  const wanted = new Set(
    [hpSlug, HP_ALIAS[hpSlug], hpSlug.replace(/-protocol$/, ""), hpSlug.replace(/-bugs$/, "")].filter(Boolean)
  );

  const tryDir = (dir: string, folder: string): LocalHunt | null => {
    if (!dir || !fs.existsSync(dir)) return null;
    const notes = readCap(path.join(dir, "NOTES.md"), 12_000);
    const hotspots = readCap(path.join(dir, "HOTSPOTS.md"), 8_000);
    const kill = readCap(path.join(dir, "KILL.md"), 8_000);
    if (!notes && !hotspots && !kill) return null;
    return { folder, dir, notes, hotspots, kill };
  };

  try {
    const projects = db()
      .prepare("SELECT slug, path, program_url FROM projects")
      .all() as { slug: string; path: string; program_url: string }[];
    for (const p of projects) {
      if (wanted.has(p.slug) || (p.program_url && p.program_url.includes(`/programs/${hpSlug}`))) {
        const hit = tryDir(p.path || path.join(root, p.slug), p.slug);
        if (hit) return hit;
      }
    }
  } catch {
    /* db may not have projects yet */
  }

  if (!fs.existsSync(root)) return null;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (wanted.has(name)) {
      const hit = tryDir(dir, name);
      if (hit) return hit;
    }
    const head = readCap(path.join(dir, "NOTES.md"), 2500);
    if (head.includes(`/programs/${hpSlug}`)) {
      const hit = tryDir(dir, name);
      if (hit) return hit;
    }
  }
  return null;
}
