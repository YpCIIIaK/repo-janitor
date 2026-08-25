/* Прогоны: список и события одного прогона.

   Источник — те же `data/bounty/<мишень>/runs/*.jsonl`, что пишет
   `runlog.py`. Формат «строка = событие» выбран ради живого чтения: файл
   дописывается прямо во время прогона, а недописанный хвост просто
   пропускается. Поэтому UI показывает ход дела без всякой очереди
   сообщений — обычным опросом. */
import fs from "node:fs";
import path from "node:path";

import { fail, ok } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

export type Event = {
  ts: string;
  seq: number;
  run: string;
  slug: string;
  kind: string;
  [k: string]: unknown;
};

function bountyRoot() {
  return path.join(workspaceRoot(), "data", "bounty");
}

function readJsonl(file: string): Event[] {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as Event);
    } catch {
      /* последняя строка может быть недописана: прогон идёт прямо сейчас */
    }
  }
  return out;
}

function findRun(id: string, slugHint = ""): string | null {
  if (!id || path.basename(id) !== id) return null;
  let root: string[];
  try {
    root = fs.readdirSync(bountyRoot());
  } catch {
    return null;
  }
  for (const slug of root) {
    if (slugHint && slug !== slugHint) continue;
    const f = path.join(bountyRoot(), slug, "runs", `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function summarize(file: string, slug: string) {
  const ev = readJsonl(file);
  if (!ev.length) return null;
  const start = ev.find((e) => e.kind === "run_start") || ev[0];
  const end = ev.find((e) => e.kind === "run_end");
  const steps = ev.filter((e) => e.kind === "step_start").length;
  const done = ev.filter((e) => e.kind === "step_end").length;
  const failed = ev.filter((e) => e.kind === "step_end" && e.status === "err").length;
  /* Прогон без `run_end` бывает двух видов: идёт прямо сейчас или процесс
     умер. Отличаем по возрасту последнего события — вечное «идёт» врёт
     ровно там, где наблюдаемость нужнее всего. */
  const lastTs = Date.parse(String(ev[ev.length - 1].ts || ""));
  const quietMin = Number.isFinite(lastTs) ? (Date.now() - lastTs) / 60000 : 999;
  const state = end ? String(end.status || "ok") : quietMin > 10 ? "оборван" : "идёт";
  const eventKinds: Record<string, number> = {};
  for (const e of ev) eventKinds[e.kind] = (eventKinds[e.kind] || 0) + 1;
  const modelEvents = ev.filter((e) => e.kind === "model_call");
  const verdictEvents = ev.filter((e) => e.kind === "verdict");
  const noteEvents = ev.filter((e) => e.kind === "note");
  const errorEvents = ev.filter((e) => e.kind === "error");
  const models = [...new Set(
    [start.model, ...modelEvents.map((e) => e.model)]
      .map((v) => String(v || ""))
      .filter(Boolean)
  )];
  return {
    id: path.basename(file, ".jsonl"),
    slug,
    action: String(start.action || ""),
    target: String(start.target || slug),
    parent: String(start.parent || ""),
    model: models[models.length - 1] || "",
    models,
    at: String(start.ts || ""),
    endedAt: String(end?.ts || ev[ev.length - 1]?.ts || start.ts || ""),
    steps,
    done,
    failed,
    candidates: ev.filter((e) => e.kind === "candidate").length,
    eventKinds,
    modelCalls: modelEvents.length,
    verdicts: {
      total: verdictEvents.length,
      ok: verdictEvents.filter((e) => Boolean(e.ok)).length,
      rejected: verdictEvents.filter((e) => !Boolean(e.ok)).length,
    },
    notes: noteEvents.length,
    errors: errorEvents.length,
    ms: end ? Number(end.ms || 0) : null,
    status: state,
    /* Прогон, где часть сигналов не запускалась (не был скачан исходник),
       успешен по коду возврата и пуст по сути. В списке это должно быть
       видно, иначе ноль зацепок читается как «чисто». */
    incomplete: Boolean(end?.incomplete),
    /* Успех + ноль результата + НИ СЛОВА о причине. Отдельный класс, и он
       дороже прочих: «ноль зацепок» читается как «чисто», а означать может
       «не смотрели». Так было дважды — Starknet и Spark. Объяснением
       считается пометка incomplete, заметка в ленте или упавший шаг;
       молчание не считается. Держится в паре с runlog.unexplained_zero,
       который заперт тестом. */
    unexplained:
      /* Только сканы: подготовка зацепок не даёт по определению, и
         предупреждение на каждом prep обесценило бы его совсем. */
      String(start.action || "") === "scan" &&
      Boolean(end) &&
      String(end?.status || "") === "ok" &&
      ev.filter((e) => e.kind === "candidate").length === 0 &&
      !end?.incomplete &&
      ev.filter((e) => e.kind === "note").length === 0 &&
      failed === 0,
    events: ev.length,
    children: [] as string[],
  };
}

type Summary = NonNullable<ReturnType<typeof summarize>>;

function allSummaries(onlySlug = ""): Summary[] {
  const rows: Summary[] = [];
  let slugs: string[] = [];
  try {
    slugs = fs.readdirSync(bountyRoot());
  } catch {
    return rows;
  }
  for (const slug of slugs) {
    if (onlySlug && slug !== onlySlug) continue;
    const dir = path.join(bountyRoot(), slug, "runs");
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const summary = summarize(path.join(dir, f), slug);
      if (summary) rows.push(summary);
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const parent = byId.get(row.parent);
    if (parent && !parent.children.includes(row.id)) parent.children.push(row.id);
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows;
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const slugHint = url.searchParams.get("slug") || "";
    const file = findRun(id, slugHint);
    if (!file) return fail("прогон не найден", 404);
    const slug = path.basename(path.dirname(path.dirname(file)));
    const since = Number(url.searchParams.get("since") || 0);
    const ev = readJsonl(file);
    const linked = allSummaries();
    const summary = linked.find((row) => row.id === id && row.slug === slug)
      || summarize(file, slug);
    const childIds = summary?.children || [];
    return ok({
      summary,
      events: since ? ev.filter((e) => e.seq > since) : ev,
      last: ev.length ? ev[ev.length - 1].seq : 0,
      children: linked.filter((row) => childIds.includes(row.id)),
      relations: {
        parent: summary?.parent || null,
        children: childIds,
      },
    });
  }

  const onlySlug = url.searchParams.get("slug") || "";
  const rows = allSummaries(onlySlug);
  return ok({ count: rows.length, rows: rows.slice(0, 60) });
}
