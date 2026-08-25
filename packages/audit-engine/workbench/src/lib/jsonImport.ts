import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { upsertHpPrograms } from "./import";
import { workspaceRoot } from "./paths";

export type ParsedTargets = {
  slugs: string[];
  titles: Record<string, string>;
  programsIngested: number;
};

function slugOf(raw: string): string {
  return raw
    .replace(/.*\/programs\//, "")
    .replace(/\/$/, "")
    .trim();
}

function fromObj(x: Record<string, unknown>, titles: Record<string, string>): string | null {
  const slug = slugOf(String(x.slug || x.program_slug || x.id || x.url || x.program || ""));
  if (!slug || slug.includes(" ") || slug.length > 120) return null;
  const title = String(x.title || x.name || x.program_name || titles[slug] || slug);
  titles[slug] = title;
  return slug;
}

export function parseScanJson(input: unknown): ParsedTargets {
  const titles: Record<string, string> = {};
  const slugs: string[] = [];
  const seen = new Set<string>();
  const hpObjs: Record<string, unknown>[] = [];

  function add(slug: string | null) {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    slugs.push(slug);
  }

  function walk(v: unknown) {
    if (v == null) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return;
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          walk(JSON.parse(t));
        } catch {
          t.split(/[\n,]+/).forEach((p) => add(slugOf(p)));
        }
        return;
      }
      t.split(/[\n,]+/).forEach((p) => add(slugOf(p)));
      return;
    }
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object" && v[0] && "slug" in (v[0] as object) && "min_reputation_points" in (v[0] as object)) {
        hpObjs.push(...(v as Record<string, unknown>[]));
      }
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.programs)) walk(o.programs);
      if (Array.isArray(o.slugs)) walk(o.slugs);
      if (Array.isArray(o.targets)) walk(o.targets);
      if (o.slug || o.url || o.program_slug) add(fromObj(o, titles));
      else if (o.min_reputation_points && o.title) {
        hpObjs.push(o);
        add(fromObj(o, titles));
      }
    }
  }

  walk(input);
  const programsIngested = hpObjs.length ? upsertHpPrograms(hpObjs) : 0;
  return { slugs, titles, programsIngested };
}

export function remember(kind: string, title: string, body = "", source = "") {
  const t = title.trim().slice(0, 220);
  if (!t) return;
  db()
    .prepare(
      `INSERT INTO scanner_memory (kind, title, body, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(kind, title) DO UPDATE SET
         body = excluded.body,
         source = excluded.source,
         weight = scanner_memory.weight + 1`
    )
    .run(kind, t, body.slice(0, 800), source);
}

/* Мост Python-петли -> память UI. `gatemem.py` (Python) пишет kill/trope-причины
   шлюза в общий `data/scan_memory.json`. Здесь они втягиваются в scanner_memory,
   откуда memoryPromptBlock кормит ими модель. Так один урок («это шаблон, не
   повторять») виден и петле в CLI, и человеку в UI, и модели на след. ходу —
   это и есть замыкание цикла из п.3 через границу двух контуров. */
let lastImport = 0;
export function importScanMemory(): number {
  // не чаще раза в 5с: memoryBlock зовут на каждый ход, файл читать каждый раз
  // незачем.
  if (Date.now() - lastImport < 5000) return 0;
  lastImport = Date.now();
  const file = path.join(workspaceRoot(), "data", "scan_memory.json");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  let store: { kill?: string[]; trope?: string[]; gate?: string[] };
  try {
    store = JSON.parse(raw);
  } catch {
    return 0;
  }
  let n = 0;
  for (const k of store.kill || []) {
    remember("kill", k, "", "gatemem");
    n++;
  }
  for (const t of store.trope || []) {
    remember("trope", t, "шаблон шлюза, не повторять без привязки к скоупу", "gatemem");
    n++;
  }
  return n;
}

export function memoryPromptBlock(): string {
  const rows = db()
    .prepare(`SELECT kind, title, body FROM scanner_memory ORDER BY weight DESC, id DESC LIMIT 40`)
    .all() as { kind: string; title: string; body: string }[];
  if (!rows.length) return "(пусто)";
  return rows.map((r) => `- [${r.kind}] ${r.title}${r.body ? `: ${r.body}` : ""}`).join("\n");
}

export function learnFromScan(programSlug: string, payload: {
  gates?: { ok?: boolean; notes?: string };
  kill?: string[];
  leads?: { title?: string }[];
}) {
  if (payload.gates?.ok === false) {
    remember("gate", `paused-or-closed:${programSlug}`, payload.gates.notes || "gates red", programSlug);
  }
  for (const k of payload.kill || []) remember("kill", k, "", programSlug);
  const tropes = /pause|timelock|fee-on-transfer|fee on transfer|unbounded loop|proxy admin|predictable nonce/i;
  for (const l of payload.leads || []) {
    const t = l.title || "";
    if (tropes.test(t)) remember("trope", t, "шаблон, не повторять без привязки к скоупу", programSlug);
  }
}
