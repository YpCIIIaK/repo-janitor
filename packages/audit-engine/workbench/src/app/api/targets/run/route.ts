/* Запуск targets.py прямо из UI: подготовка мишени и прогон сигналов.

   Обе операции ДОЛГИЕ — скачивание деревьев и пять инструментов по каждому
   репозиторию идут минутами. Поэтому процесс отвязан от запроса: вывод течёт
   в `data/bounty/<slug>/ui-<action>.log`, а страница опрашивает GET и
   показывает хвост. Никакого состояния в памяти, кроме списка живых pid. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fail, ok, readJson } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const running = new Map<string, number>(); // slug:action -> pid

function python() {
  if (process.env.AUDITSCOUT_PYTHON) return process.env.AUDITSCOUT_PYTHON;
  // Тот же интерпретатор, что велит STATE.md: в venv нет pypdf, и отчёты
  // молча читаются пустыми.
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const p = path.join(local, "Programs", "Python", "Python313", "python.exe");
    if (fs.existsSync(p)) return p;
  }
  return "python";
}

function logFile(slug: string, action: string) {
  // `--check` идёт сразу по всем мишеням, папки у него нет — кладём в общую.
  const dir = path.join(workspaceRoot(), "data", "bounty", action === "check" ? "_all" : slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `ui-${action}.log`);
}

function argsFor(slug: string, action: string) {
  if (action === "check") return ["targets.py", "--check"];
  // «Пересканировать» — тот же скан, но прошлые сигналы уезжают в archive/vN,
  // а в конце печатается разница. Иначе перезапись стирает то, с чем
  // сравнивать, и вопрос «стало ли лучше после правки пайплайна» без ответа.
  if (action === "rescan") return ["targets.py", "--scan", slug, "--fresh"];
  return ["targets.py", `--${action}`, slug];
}

export async function POST(req: Request) {
  const b = await readJson<{ slug?: string; action?: string }>(req);
  const slug = (b.slug || "").trim();
  const ALLOWED = new Set(["scan", "check", "prep", "rescan"]);
  const action = ALLOWED.has(String(b.action)) ? String(b.action) : "prep";
  if (!slug && action !== "check") return fail("нужен slug");
  const key = `${slug}:${action}`;
  if (running.has(key)) return ok({ started: false, running: true });
  // Скан по мишени, у которой ещё идёт подготовка, видит ПУСТУЮ папку src и
  // молча пропускает все сигналы «от дерева». Так и вышло со Starknet:
  // шесть шагов вместо десяти, семь секунд и ноль зацепок — не «чисто», а
  // «не смотрели». Поэтому блокировка не по действию, а по МИШЕНИ.
  const busy = [...running.keys()].find((k) => k.startsWith(`${slug}:`));
  if (busy && action !== "check") {
    return ok({
      started: false,
      running: true,
      busy: busy.split(":")[1],
      error: `по этой мишени уже идёт «${busy.split(":")[1]}» — дождитесь конца`,
    });
  }

  const file = logFile(slug, action);
  fs.writeFileSync(file, `$ targets.py --${action} ${action === "check" ? "" : slug}\n`, "utf8");
  const out = fs.openSync(file, "a");
  const child = spawn(python(), argsFor(slug, action), {
    cwd: workspaceRoot(),
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  running.set(key, child.pid ?? -1);
  child.on("exit", (code) => {
    running.delete(key);
    try {
      fs.appendFileSync(file, `\n[выход ${code}]\n`, "utf8");
      fs.closeSync(out);
    } catch {
      /* лог уже закрыт */
    }
  });
  return ok({ started: true, pid: child.pid });
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") || "";
  const a = String(url.searchParams.get("action") || "");
  // Тот же набор, что и в POST: иначе опрос «пересканирования» читал бы лог
  // подготовки и показывал чужой хвост.
  const action = ["scan", "check", "prep", "rescan"].includes(a) ? a : "prep";
  if (!slug && action !== "check") return fail("нужен slug");
  let text = "";
  try {
    text = fs.readFileSync(logFile(slug, action), "utf8");
  } catch {
    text = "";
  }
  const lines = text.split("\n");
  return ok({
    running: running.has(`${slug}:${action}`),
    tail: lines.slice(-40).join("\n"),
    lines: lines.length,
  });
}
