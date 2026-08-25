import fs from "node:fs";
import path from "node:path";
import { db, ftsRebuild, getSetting } from "./db";
import { auditsRoot, bountyRoot, workspaceRoot } from "./paths";

const SKIP_DIRS = new Set([
  "repos",
  "node_modules",
  ".git",
  "poc",
  "scan-out",
  "tools",
  "hp_leaderboard",
  "fresh",
  // `targets.py --prep` кладёт СКАЧАННЫЕ чужие репозитории в <мишень>/src,
  // а вывод инструментов — в <мишень>/signals. Это не наши заметки: обход
  // затягивал индексацию на минуты (одна мишень Lido — 19 репозиториев и
  // тысячи .md), и дашборд вставал на «считаю».
  "src",
  "signals",
]);

function readText(p: string, max = 400_000): string {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 2_000_000) return "";
    return fs.readFileSync(p, "utf8").slice(0, max);
  } catch {
    return "";
  }
}

function upsertProject(slug: string, title: string, dir: string, notes: string, stopped: string, status: string) {
  const d = db();
  d.prepare(
    `INSERT INTO projects (slug, title, status, path, notes, stopped_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(slug) DO UPDATE SET
       title=excluded.title,
       path=excluded.path,
       notes=excluded.notes,
       stopped_at=CASE WHEN excluded.stopped_at != '' THEN excluded.stopped_at ELSE projects.stopped_at END,
       status=CASE WHEN excluded.status != '' THEN excluded.status ELSE projects.status END,
       updated_at=datetime('now')`
  ).run(slug, title, status || "parked", dir, notes, stopped);
  const row = d.prepare("SELECT id FROM projects WHERE slug = ?").get(slug) as { id: number };
  return row.id;
}

function parseHotspots(md: string): { code: string; title: string; verdict: string }[] {
  const out: { code: string; title: string; verdict: string }[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 3) continue;
    if (/^-+$/.test(cols[0].replace(/:/g, "")) || cols[0].toLowerCase() === "id") continue;
    out.push({ code: cols[0], title: cols[1] || cols[0], verdict: cols.slice(2).join(" · ") });
  }
  return out;
}

function extractStopped(notes: string): string {
  const m = notes.match(/## STOPPED HERE[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/);
  return m ? m[0].slice(0, 4000) : "";
}

function guessStatus(slug: string, notes: string): string {
  const sm = notes.match(/\*\*Status:\*\*\s*(active|parked|watch|killed)/i);
  if (sm) return sm[1].toLowerCase();
  const n = notes.toLowerCase();
  if (slug === "aa-4337") return "active";
  if (n.includes("stopped here")) return "active";
  if (n.includes("watch reconnect") || n.includes("**watch**")) return "watch";
  return "parked";
}

export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function scaffoldTrack(opts: {
  slug: string;
  title: string;
  platform?: string;
  program_url?: string;
  status?: string;
}): { slug: string; dir: string; created: string[] } {
  const slug = normalizeSlug(opts.slug);
  if (!slug) throw new Error("пустой slug");
  const dir = path.join(bountyRoot(), slug);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  const status = opts.status || "active";
  const files: [string, string][] = [
    [
      "NOTES.md",
      `# ${opts.title}

**Status:** ${status}  
**Platform:** ${opts.platform || ""}  
**Program:** ${opts.program_url || ""}  
**Path:** \`${dir}\`

## Скоуп
(вписать репо / адреса)

## Crit
(что считается выплатой)

## STOPPED HERE
Старт. Шаг 0 ворота → hotspots.
`,
    ],
    [
      "HOTSPOTS.md",
      `# HOTSPOTS — ${opts.title}

| ID | Surface | Почему |
|----|---------|--------|
| X1 |  |  |

Стоп-лосс: 3 CLEAN Crit/High или ~8–12ч.
`,
    ],
    [
      "KILL.md",
      `# KILL — ${opts.title}

- Не в скоупе
- Known / already disclosed
- Нет PoC → не сабмитить
`,
    ],
    [
      "DIG.md",
      `# DIG — ${opts.title}

## STOPPED HERE
Ещё не копали.
`,
    ],
  ];
  for (const [name, body] of files) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, body, "utf8");
      created.push(name);
    }
  }
  fs.mkdirSync(path.join(dir, "repos"), { recursive: true });
  return { slug, dir, created };
}

function indexFile(projectId: number | null, kind: string, title: string, sourcePath: string, body: string) {
  if (!body.trim()) return;
  const d = db();
  const existing = d
    .prepare("SELECT id FROM documents WHERE source_path = ?")
    .get(sourcePath) as { id: number } | undefined;
  if (existing) {
    d.prepare(
      "UPDATE documents SET project_id=?, kind=?, title=?, body=?, updated_at=datetime('now') WHERE id=?"
    ).run(projectId, kind, title, body, existing.id);
  } else {
    d.prepare(
      "INSERT INTO documents (project_id, kind, title, source_path, body) VALUES (?, ?, ?, ?, ?)"
    ).run(projectId, kind, title, sourcePath, body);
  }
}

function walkMd(dir: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 4) return acc;
  let ents: fs.Dirent[] = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walkMd(p, acc, depth + 1);
    } else if (/\.(md|txt)$/i.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

export function importTracks(): number {
  const root = bountyRoot();
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory() || SKIP_DIRS.has(name)) continue;
    const notesPath = path.join(dir, "NOTES.md");
    const hotPath = path.join(dir, "HOTSPOTS.md");
    const killPath = path.join(dir, "KILL.md");
    const digPath = path.join(dir, "DIG.md");
    if (![notesPath, hotPath, killPath, digPath].some((p) => fs.existsSync(p))) continue;

    const notes = readText(notesPath);
    const titleMatch = notes.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : name;
    const stopped = extractStopped(notes) || extractStopped(readText(digPath));
    const status = guessStatus(name, notes + readText(digPath));
    const id = upsertProject(name, title, dir, notes, stopped, status);
    n++;

    db().prepare("DELETE FROM hotspots WHERE project_id = ?").run(id);
    const insH = db().prepare(
      "INSERT INTO hotspots (project_id, code, title, verdict, body, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    parseHotspots(readText(hotPath)).forEach((h, i) => insH.run(id, h.code, h.title, h.verdict, h.verdict, i));

    for (const [kind, p] of [
      ["notes", notesPath],
      ["hotspots", hotPath],
      ["kill", killPath],
      ["dig", digPath],
    ] as const) {
      if (fs.existsSync(p)) indexFile(id, kind, `${name} / ${kind}`, p, readText(p));
    }

    for (const f of fs.readdirSync(dir)) {
      if (/^LEAD-.*\.md$/i.test(f) || /^FINDING.*\.md$/i.test(f)) {
        const p = path.join(dir, f);
        const body = readText(p);
        indexFile(id, "lead", f, p, body);
        const existing = db()
          .prepare("SELECT id FROM findings WHERE project_id = ? AND title = ?")
          .get(id, f) as { id: number } | undefined;
        if (!existing) {
          db()
            .prepare(
              "INSERT INTO findings (project_id, title, severity, status, body, files) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run(id, f.replace(/\.md$/i, ""), "", "lead", body, p);
        }
      }
    }
  }
  return n;
}

export function upsertHpPrograms(list: Record<string, unknown>[]): number {
  const d = db();
  const ins = d.prepare(
    `INSERT OR REPLACE INTO programs (slug, title, min_rep, max_bounty, min_bounty, paid, submissions, fee, kyc, poc, unending, audit_program, private, status, languages, types, url, extra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const x of list) {
    const slug = String(x.slug || "");
    if (!slug) continue;
    const labels = (x.labels as Record<string, unknown>) || {};
    const status = ((x.status as Record<string, unknown>) || {}).name || String(x.status || "");
    ins.run(
      slug,
      String(x.title || ""),
      Number(x.min_reputation_points ?? x.min_rep ?? 0),
      x.max_bounty != null ? Number(x.max_bounty) : null,
      x.min_bounty != null ? Number(x.min_bounty) : null,
      x.total_rewards != null ? Number(x.total_rewards) : x.paid != null ? Number(x.paid) : null,
      Number(x.submitted_reports ?? x.submissions ?? 0),
      x.submission_cost != null ? Number(x.submission_cost) : x.fee != null ? Number(x.fee) : null,
      x.kyc_required || x.kyc ? 1 : 0,
      x.poc_required || x.poc ? 1 : 0,
      x.unending_program || x.unending ? 1 : 0,
      x.audit_program ? 1 : 0,
      x.private ? 1 : 0,
      String(status),
      JSON.stringify(labels.languages || x.languages || []),
      JSON.stringify(labels.types || x.types || []),
      String(x.url || `https://hackenproof.com/programs/${slug}`),
      JSON.stringify({ end: x.end_date, dual: x.dual_defence })
    );
    n++;
  }
  return n;
}

export function importPrograms(): number {
  const p = path.join(bountyRoot(), "hp_leaderboard", "programs_raw.json");
  if (!fs.existsSync(p)) return 0;
  const list = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>[];
  const d = db();
  d.exec("DELETE FROM programs");
  return upsertHpPrograms(list);
}

export function importDisclosed(): number {
  const p = path.join(bountyRoot(), "hp_leaderboard", "reports_open.json");
  if (!fs.existsSync(p)) return 0;
  const list = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>[];
  const d = db();
  d.exec("DELETE FROM disclosed");
  const ins = d.prepare(
    `INSERT INTO disclosed (handle, rank, title, severity, program, bounty, url, report_id, disclosed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const x of list) {
    ins.run(
      String(x.handle || ""),
      x.rank != null ? Number(x.rank) : null,
      String(x.title || ""),
      String(x.severity || ""),
      String(x.program || ""),
      x.bounty != null && x.bounty !== "" ? Number(x.bounty) : null,
      String(x.url || ""),
      String(x.id || ""),
      String(x.disclosed_at || "")
    );
  }
  return list.length;
}

export function importAudits(): number {
  let n = 0;
  const roots = [auditsRoot(), bountyRoot()];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = walkMd(root);
    for (const f of files) {
      const rel = path.relative(workspaceRoot(), f);
    if (!/audit/i.test(rel) && !/AUDITS/i.test(path.basename(f)) && !/audits-text/i.test(rel)) continue;
      const body = readText(f);
      if (!body) continue;
      let projectId: number | null = null;
      const m = rel.replace(/\\/g, "/").match(/data\/bounty\/([^/]+)\//);
      if (m) {
        const row = db().prepare("SELECT id FROM projects WHERE slug = ?").get(m[1]) as { id: number } | undefined;
        projectId = row?.id ?? null;
      }
      indexFile(projectId, "audit", path.basename(f), f, body);
      n++;
    }
  }
  const method = path.join(bountyRoot(), "METHOD.md");
  if (fs.existsSync(method)) indexFile(null, "method", "METHOD", method, readText(method));
  const next = path.join(bountyRoot(), "NEXT.md");
  if (fs.existsSync(next)) indexFile(null, "queue", "NEXT", next, readText(next));
  const parked = path.join(bountyRoot(), "PARKED.md");
  if (fs.existsSync(parked)) indexFile(null, "queue", "PARKED", parked, readText(parked));
  return n;
}

export function importAll() {
  const out = { tracks: 0, programs: 0, disclosed: 0, audits: 0, errors: [] as string[] };
  try {
    out.tracks = importTracks();
  } catch (e) {
    out.errors.push("tracks: " + String(e));
  }
  try {
    out.programs = importPrograms();
  } catch (e) {
    out.errors.push("programs: " + String(e));
  }
  try {
    out.disclosed = importDisclosed();
  } catch (e) {
    out.errors.push("disclosed: " + String(e));
  }
  try {
    out.audits = importAudits();
  } catch (e) {
    out.errors.push("audits: " + String(e));
  }
  ftsRebuild();
  return { ...out, current_project: getSetting("current_project", "aa-4337") };
}
