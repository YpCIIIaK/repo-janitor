/* Запуск веб-петли модели прямо из UI: webagent.py по живой мишени.

   Как и targets/run — процесс отвязан от запроса: вывод течёт в
   data/web/sites/<slug>/ui-loop.log, страница опрашивает GET и показывает
   хвост. Кандидаты (сверенные ПОВТОРНЫМ ЖИВЫМ запросом в webverify) модель
   пишет в loop.json (--out); на выходе они вливаются в общий список находок,
   чтобы видеть полную картину. Модель зафиксирована HEAVY. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getSetting } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";
import { webFindingsPath, webSiteDir } from "@/lib/webPaths";
import { getWebTarget } from "@/lib/webTargets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const running = new Map<string, number>(); // slug -> pid

function python() {
  if (process.env.AUDITSCOUT_PYTHON) return process.env.AUDITSCOUT_PYTHON;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const p = path.join(local, "Programs", "Python", "Python313", "python.exe");
    if (fs.existsSync(p)) return p;
  }
  return "python";
}

type Candidate = { kind: string; url: string; impact: string; detail: string };

function mergeCandidates(slug: string, name: string) {
  let loop: { candidates?: Candidate[]; at?: string; model?: string };
  try {
    loop = JSON.parse(fs.readFileSync(path.join(webSiteDir(slug), "loop.json"), "utf8"));
  } catch {
    return;
  }
  if (!loop.candidates?.length) return;
  let findings: Record<string, unknown>[] = [];
  try {
    findings = JSON.parse(fs.readFileSync(webFindingsPath(), "utf8"));
  } catch {
    findings = [];
  }
  for (const c of loop.candidates) {
    findings.unshift({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      slug,
      name,
      cls: c.kind,
      // Заголовок и note — ТОЛЬКО из сверенной гейтом улики (c.detail).
      // Проза модели (c.impact) в заголовок не идёт: она может содержать
      // выдуманную конкретику. Её кладём отдельно и помечаем «не сверено».
      title: `${c.kind}: ${c.detail}`,
      status: "loop",
      severity: c.kind === "exposed_file" ? "medium" : "info",
      note: c.detail,
      claim: c.impact,
      claimVerified: false,
      url: c.url,
      source: `webagent(${loop.model || "heavy"})`,
      at: loop.at || new Date().toISOString(),
    });
  }
  fs.writeFileSync(webFindingsPath(), JSON.stringify(findings, null, 1), "utf8");
}

export async function POST(req: Request) {
  const b = await readJson<{ slug?: string; steps?: number }>(req);
  const slug = (b.slug || "").trim();
  if (!slug) return fail("нужен slug");
  const t = getWebTarget(slug);
  if (!t) return fail("сначала добавь сайт в /web/sites");
  const host = (t.hosts || [])[0];
  if (!host) return fail("нет хоста в скоупе");
  if (running.has(slug)) return ok({ started: false, running: true });

  const key = process.env.OPENROUTER_API_KEY || getSetting("openrouter_key", "");
  if (!key) return fail("нет ключа OpenRouter — задай в настройках");

  const steps = Number.isInteger(b.steps) && b.steps! > 0 && b.steps! <= 16 ? b.steps! : 10;
  const dir = webSiteDir(slug);
  const logPath = path.join(dir, "ui-loop.log");
  const outPath = path.join(dir, "loop.json");
  const allowArgs = (t.hosts || []).flatMap((h) => ["--allow", h]);
  const args = [
    "webagent.py",
    ...allowArgs,
    "--base", `https://${host}/`,
    "--model", "heavy", // зафиксировано HEAVY по решению
    "--steps", String(steps),
    "--out", outPath,
  ];

  fs.writeFileSync(logPath, `$ webagent.py --model heavy --steps ${steps} (${host})\n`, "utf8");
  const out = fs.openSync(logPath, "a");
  const child = spawn(python(), args, {
    cwd: workspaceRoot(),
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, OPENROUTER_API_KEY: key },
  });
  running.set(slug, child.pid ?? -1);
  child.on("exit", (code) => {
    running.delete(slug);
    try {
      mergeCandidates(slug, t.name);
      fs.appendFileSync(logPath, `\n[выход ${code}]\n`, "utf8");
      fs.closeSync(out);
    } catch {
      /* лог уже закрыт */
    }
  });
  return ok({ started: true, pid: child.pid, model: "heavy", steps });
}

export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!slug) return fail("нужен slug");
  const dir = webSiteDir(slug);
  let tail = "";
  try {
    const lines = fs.readFileSync(path.join(dir, "ui-loop.log"), "utf8").split("\n");
    tail = lines.slice(-50).join("\n");
  } catch {
    tail = "";
  }
  let candidates: Candidate[] = [];
  let at = "";
  try {
    const loop = JSON.parse(fs.readFileSync(path.join(dir, "loop.json"), "utf8"));
    candidates = loop.candidates || [];
    at = loop.at || "";
  } catch {
    /* ещё не было прогона */
  }
  return ok({ running: running.has(slug), tail, candidates, at });
}
