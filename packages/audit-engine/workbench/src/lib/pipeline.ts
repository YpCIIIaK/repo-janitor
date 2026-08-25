import { db } from "./db";
import { chatJson, openRouterModel } from "./openrouter";
import { extractGithubUrls, fetchAllowed, githubReadmeUrls } from "./web";
import { importTracks, normalizeSlug, scaffoldTrack } from "./import";
import { importScanMemory, learnFromScan, memoryPromptBlock } from "./jsonImport";
import { claimJob } from "./jobControl";
import { JobRunLog, safeRunSegment } from "./jobRunLog";
import {
  loadLocalHunt,
  parseHotspotMd,
  parseKillMd,
  replaceHotspots,
  upsertDoc,
  writeHotspotsFile,
  writeNotesFile,
  type HotspotRow,
} from "./trackFiles";

const SYSTEM = `Ты аналитик bug bounty. Пиши только JSON, без markdown вокруг.
Задача: выжимка программы + гипотезы для ЧЕЛОВЕКА. Не пиши эксплойты, payload, PoC-шаги атаки по шагам.
Правила:
- ворота важнее кода: private/paused, KYC/fee, min reputation, Crit-only+recoverable
- severity ≠ $; микро-пулы — низкий EV
- не предлагай то, что в OOS / known issues / FP families / память сканера (шаблоны)
- web XSS без impact — слабый EV; CEX web — только гипотезы IDOR/auth/вывод, без инструкций взлома
- EVM/Solidity приоритетнее, если программа смешанная
Если дан блок «ЛОКАЛЬНЫЙ ТРЕК» — это истина охоты. Не подменяй generic checklist (merkle/timelock/replay/FoT/proxy-admin).
- hotspots: те же ID (H1…) и вердикты (CLEAN/LEAD/park) что в HOTSPOTS
- kill: известные/fixed из KILL
- leads: только ещё открытые LEAD из трека; не выдумывай новые
- summary: где остановились и почему не копать / что осталось
- hunted: true
Поля JSON:
{
  "hunted": false,
  "gates": {"ok": true, "rep": 0, "fee": 0, "notes": ""},
  "scope": ["..."],
  "oos": ["..."],
  "payouts": "",
  "hotspots": [{"code":"H1","title":"","why":"","severity":"High"}],
  "leads": [{"title":"","severity":"High","hypothesis":"","why_not_oos":"","p_dupe":"high|med|low"}],
  "kill": ["..."],
  "summary": "3-6 предложений"
}
Максимум 8 hotspots и 5 leads. Если ворота красные — leads пустой, gates.ok=false.`;

export type ScanPayload = {
  hunted?: boolean;
  gates?: { ok?: boolean; rep?: number; fee?: number; notes?: string };
  scope?: string[];
  oos?: string[];
  payouts?: string;
  hotspots?: { code?: string; title?: string; why?: string; severity?: string }[];
  leads?: {
    title?: string;
    severity?: string;
    hypothesis?: string;
    why_not_oos?: string;
    p_dupe?: string;
  }[];
  kill?: string[];
  summary?: string;
};

function memoryBlock(): string {
  importScanMemory(); // втянуть свежие kill-причины Python-петли перед промптом
  const learned = memoryPromptBlock();
  const kills = db()
    .prepare(
      `SELECT title, status FROM findings WHERE status IN ('kill','clean') ORDER BY updated_at DESC LIMIT 12`
    )
    .all() as { title: string; status: string }[];
  const extra = kills.map((x) => `- ${x.status}: ${x.title}`).join("\n");
  return `${learned}${extra ? `\n${extra}` : ""}`;
}

export async function processNextJob(
  options: string | { target?: string; jobId?: number; signal?: AbortSignal } = {}
): Promise<{ did: boolean; jobId?: number; reportId?: number; runId?: string; status?: string; error?: string }> {
  const opts = typeof options === "string" ? { target: options } : options;
  const job = claimJob(opts.jobId, opts.target);
  if (!job) return { did: false };
  const id = Number(job.id);
  const token = String(job.worker_token);
  const slug = safeRunSegment(normalizeSlug(String(job.target)), `job-${id}`);
  const log = new JobRunLog(slug, id);
  db().prepare("UPDATE jobs SET run_id=? WHERE id=? AND worker_token=?").run(log.runId, id, token);
  log.emit("run_start", { action: "summarize", target: String(job.target), attempt: Number(job.attempt) });
  try {
    const reportId = await runJob(job, opts.signal, log);
    const completed = db()
      .prepare(
        `UPDATE jobs SET status='done', finished_at=datetime('now'), report_id=?, worker_token=NULL
         WHERE id=? AND status='running' AND worker_token=? AND stop_requested_at IS NULL`
      )
      .run(reportId, id, token);
    if (!completed.changes) throw new Error("job stop requested");
    log.end("ok", { report_id: reportId });
    return { did: true, jobId: id, reportId, runId: log.runId, status: "done" };
  } catch (e) {
    const msg = String(e).slice(0, 800);
    const stopRow = db().prepare("SELECT stop_requested_at FROM jobs WHERE id=?").get(id) as
      | { stop_requested_at?: string }
      | undefined;
    const stopped = Boolean(opts.signal?.aborted || stopRow?.stop_requested_at);
    const status = stopped ? "stopped" : "error";
    log.failActive(msg, stopped);
    db().prepare(
      `UPDATE jobs SET status=?, finished_at=datetime('now'), error=?, worker_token=NULL
       WHERE id=? AND status='running' AND worker_token=?`
    ).run(status, stopped ? "" : msg, id, token);
    log.emit("error", { error: msg, stopped });
    log.end(stopped ? "stopped" : "err", { error: stopped ? undefined : msg });
    return { did: true, jobId: id, runId: log.runId, status, error: stopped ? undefined : msg };
  }
}

async function runJob(job: Record<string, unknown>, signal: AbortSignal | undefined, log: JobRunLog): Promise<number> {
  const target = String(job.target || "");
  const title = String(job.title || target);
  const kind = String(job.kind || "program");

  let program: Record<string, unknown> | undefined;
  if (kind === "program" || target.includes("hackenproof.com")) {
    const slug = target.replace(/.*\/programs\//, "").replace(/\/$/, "");
    program = db().prepare("SELECT * FROM programs WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
  }

  const url =
    (program && String(program.url)) ||
    (target.startsWith("http") ? target : `https://hackenproof.com/programs/${target}`);

  signal?.throwIfAborted();
  log.stepStart("fetch_hp");
  const page = await fetchAllowed(url, signal);
  log.stepEnd("fetch_hp", "ok", { url, fetched: page.ok });
  const gh = extractGithubUrls(page.text);
  const extras: string[] = [];
  log.stepStart("fetch_github");
  for (const g of gh.slice(0, 2)) {
    signal?.throwIfAborted();
    let got = false;
    for (const u of githubReadmeUrls(g)) {
      const readme = await fetchAllowed(u, signal);
      if (readme.ok) {
        extras.push(`SOURCE ${u}\n${readme.text.slice(0, 8000)}`);
        got = true;
        break;
      }
    }
    if (!got) {
      const pageGh = await fetchAllowed(g, signal);
      if (pageGh.ok) extras.push(`SOURCE ${g}\n${pageGh.text.slice(0, 8000)}`);
    }
  }
  log.stepEnd("fetch_github", "ok", { repositories: gh.slice(0, 2).length, sources: extras.length });

  const progJson = program ? JSON.stringify(program).slice(0, 4000) : "";
  const slugGuess = program ? String(program.slug) : normalizeSlug(String(job.target));
  const hunt = loadLocalHunt(slugGuess);
  const local = hunt
    ? `ЛОКАЛЬНЫЙ ТРЕК (уже копали, папка ${hunt.folder}):
NOTES:
${hunt.notes}

HOTSPOTS:
${hunt.hotspots}

KILL:
${hunt.kill}
`
    : "ЛОКАЛЬНЫЙ ТРЕК: нет — это первый проход, гипотезы по странице/README, без выдуманного чеклиста.";

  const user = `Программа: ${title}
URL: ${url}
Каталог HP: ${progJson || "нет"}
Память сканера:
${memoryBlock()}

${local}

Текст страницы HP:
${page.text.slice(0, hunt ? 8000 : 18000)}

${extras.join("\n\n")}
`;

  signal?.throwIfAborted();
  log.stepStart("model");
  const { raw, parsed } = await chatJson(SYSTEM, user, signal);
  log.emit("model_call", {
    model: openRouterModel(),
    tier: openRouterModel().includes("free") ? "free" : "standard",
    answered: true,
    calls: [],
  });
  log.stepEnd("model", "ok", { model: openRouterModel() });
  const payload = (parsed && typeof parsed === "object" ? parsed : { summary: raw.slice(0, 2000), parse_error: true }) as ScanPayload;
  if (hunt) {
    payload.hunted = true;
    const localHs = parseHotspotMd(hunt.hotspots);
    if (localHs.length) payload.hotspots = localHs;
    const localKill = parseKillMd(hunt.kill);
    if (localKill.length) payload.kill = localKill;
  }

  signal?.throwIfAborted();
  log.stepStart("persist");
  const ins = db().prepare(
    `INSERT INTO reports (job_id, program_slug, title, model, summary, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const slug = program ? String(program.slug) : normalizeSlug(String(job.target));
  const r = ins.run(
    Number(job.id),
    slug,
    title,
    openRouterModel(),
    payload.summary || "",
    JSON.stringify(payload)
  );
  const reportId = Number(r.lastInsertRowid);

  const add = db().prepare(
    `INSERT INTO report_items (report_id, kind, title, severity, body, extra) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const h of payload.hotspots || []) {
    add.run(reportId, "hotspot", `${h.code || ""} ${h.title || ""}`.trim(), h.severity || "", h.why || "", "");
  }
  for (const l of payload.leads || []) {
    add.run(
      reportId,
      "lead",
      l.title || "lead",
      l.severity || "",
      `${l.hypothesis || ""}\n\nПочему не OOS: ${l.why_not_oos || ""}\nP(dupe): ${l.p_dupe || ""}`,
      JSON.stringify(l)
    );
  }
  for (const k of payload.kill || []) add.run(reportId, "kill", k.slice(0, 180), "", k, "");
  for (const s of payload.scope || []) add.run(reportId, "scope", s.slice(0, 180), "", s, "");
  for (const s of payload.oos || []) add.run(reportId, "oos", s.slice(0, 180), "", s, "");

  learnFromScan(slug, payload);
  log.stepEnd("persist", "ok", { report_id: reportId });
  return reportId;
}

export function applyReport(reportId: number): { projectId: number; leads: number; hotspots: number; skippedWrite?: boolean } {
  const report = db().prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as Record<string, unknown> | undefined;
  if (!report) throw new Error("report not found");
  const payload = JSON.parse(String(report.payload || "{}")) as ScanPayload;
  const hpSlug = String(report.program_slug || "");
  const hunt = loadLocalHunt(hpSlug);
  if (hunt) {
    importTracks();
    const project = db().prepare("SELECT * FROM projects WHERE slug = ?").get(hunt.folder) as Record<string, unknown> | undefined;
    if (!project) throw new Error(`трек ${hunt.folder} не в индексе — сначала Индексировать диск`);
    const projectId = Number(project.id);
    db().prepare("UPDATE reports SET project_id=? WHERE id=?").run(projectId, reportId);
    return { projectId, leads: 0, hotspots: 0, skippedWrite: true };
  }
  const slug = normalizeSlug(String(report.program_slug || report.title || `scan-${reportId}`));
  scaffoldTrack({
    slug,
    title: String(report.title),
    platform: "hackenproof",
    program_url: `https://hackenproof.com/programs/${slug}`,
    status: payload.gates?.ok === false ? "parked" : "active",
  });
  importTracks();
  const project = db().prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as Record<string, unknown>;
  const projectId = Number(project.id);

  const notes = `# ${report.title}

**Status:** ${payload.gates?.ok === false ? "parked" : "active"}  
**Program:** https://hackenproof.com/programs/${slug}

## Выжимка (модель)
${payload.summary || ""}

## Скоуп
${(payload.scope || []).map((x) => `- ${x}`).join("\n")}

## OOS
${(payload.oos || []).map((x) => `- ${x}`).join("\n")}

## Payouts
${payload.payouts || ""}

## Gates
${payload.gates?.notes || ""}
`;
  writeNotesFile({ path: String(project.path), slug, title: String(project.title) }, notes);
  db().prepare(`UPDATE projects SET notes=?, program_url=?, updated_at=datetime('now') WHERE id=?`).run(
    notes,
    `https://hackenproof.com/programs/${slug}`,
    projectId
  );
  upsertDoc(projectId, "notes", `${slug} / notes`, String(project.path) + "\\NOTES.md", notes);

  const rows: HotspotRow[] = (payload.hotspots || []).map((h, i) => ({
    code: h.code || `H${i + 1}`,
    title: h.title || "",
    verdict: `${h.severity || ""} · ${h.why || ""}`,
  }));
  replaceHotspots(projectId, rows);
  writeHotspotsFile({ path: String(project.path), slug, title: String(project.title) }, rows);

  let leads = 0;
  for (const l of payload.leads || []) {
    const title = l.title || "lead";
    const exists = db()
      .prepare("SELECT id FROM findings WHERE project_id=? AND title=?")
      .get(projectId, title) as { id: number } | undefined;
    if (exists) continue;
    db()
      .prepare(
        `INSERT INTO findings (project_id, title, severity, status, body, files)
         VALUES (?, ?, ?, 'lead', ?, ?)`
      )
      .run(
        projectId,
        title,
        l.severity || "",
        `${l.hypothesis || ""}\n\nПочему не OOS: ${l.why_not_oos || ""}\nP(dupe): ${l.p_dupe || ""}\n[auto report ${reportId}]`,
        `report:${reportId}`
      );
    leads++;
  }

  db().prepare("UPDATE reports SET project_id=? WHERE id=?").run(projectId, reportId);
  return { projectId, leads, hotspots: rows.length };
}

export function enqueuePrograms(slugs: string[], titles: Record<string, string> = {}, opts: { skipReported?: boolean } = {}) {
  const ins = db().prepare(`INSERT INTO jobs (kind, target, title, status) VALUES ('program', ?, ?, 'queued')`);
  let n = 0;
  for (const s of slugs) {
    const slug = s.replace(/.*\/programs\//, "").replace(/\/$/, "");
    if (!slug) continue;
    if (opts.skipReported !== false) {
      const had = db().prepare(`SELECT id FROM reports WHERE program_slug = ? LIMIT 1`).get(slug);
      if (had) continue;
    }
    const dup = db()
      .prepare(`SELECT id FROM jobs WHERE target=? AND status IN ('queued','running')`)
      .get(slug) as { id: number } | undefined;
    if (dup) continue;
    const title =
      titles[slug] ||
      (db().prepare("SELECT title FROM programs WHERE slug=?").get(slug) as { title?: string } | undefined)?.title ||
      slug;
    ins.run(slug, title);
    n++;
  }
  return n;
}
