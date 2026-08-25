/* Ручной приём мишени: имя, ссылка, вставленный текст условий.

   Зачем отдельно от `/api/targets/run`: там запускают действие по УЖЕ
   выбранной мишени, а здесь мишени ещё нет — она из этого запроса и
   рождается. Общего у них только устройство: процесс отвязан от запроса,
   вывод течёт в файл, страница опрашивает GET и показывает хвост.

   Текст условий кладём во временный файл, а не в аргумент командной строки:
   условия бывают на десятки килобайт, а длина командной строки в Windows
   ограничена ~32k — на длинном скоупе запуск молча падал бы. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fail, ok, readJson } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let running = false;

function python() {
  if (process.env.AUDITSCOUT_PYTHON) return process.env.AUDITSCOUT_PYTHON;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const p = path.join(local, "Programs", "Python", "Python313", "python.exe");
    if (fs.existsSync(p)) return p;
  }
  return "python";
}

function dir() {
  const d = path.join(workspaceRoot(), "data", "bounty", "_intake");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const logFile = () => path.join(dir(), "ui-intake.log");

export async function POST(req: Request) {
  const b = await readJson<{ name?: string; url?: string; terms?: string; add?: boolean }>(req);
  const name = (b.name || "").trim();
  const url = (b.url || "").trim();
  const terms = String(b.terms || "");
  if (!name) return fail("нужно имя мишени");
  if (!url && !terms.trim()) {
    // Без источника приём выродится в вопрос к модели «а что там в скоупе»,
    // и она ответит правдоподобно. Это ровно то, чего инструмент избегает.
    return fail("нужна ссылка или вставленный текст условий");
  }
  if (running) return ok({ started: false, running: true, error: "приём уже идёт" });

  const termsFile = path.join(dir(), "terms.txt");
  fs.writeFileSync(termsFile, terms, "utf8");

  const args = ["intake.py", "--name", name];
  if (url) args.push("--url", url);
  if (terms.trim()) args.push("--terms", termsFile);
  if (b.add !== false) args.push("--add");

  const file = logFile();
  fs.writeFileSync(file, `$ intake.py --name ${name}${url ? ` --url ${url}` : ""}\n`, "utf8");
  const out = fs.openSync(file, "a");
  const child = spawn(python(), args, {
    cwd: workspaceRoot(),
    stdio: ["ignore", out, out],
    windowsHide: true,
    // Дочерний питон пишет по-русски: без этого консоль Windows роняет
    // процесс на первой же кириллице в cp1251.
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  running = true;
  child.on("exit", (code) => {
    running = false;
    try {
      fs.appendFileSync(file, `\n[выход ${code}]\n`, "utf8");
      fs.closeSync(out);
    } catch {
      /* лог уже закрыт */
    }
  });
  return ok({ started: true, pid: child.pid });
}

export function GET() {
  let text = "";
  try {
    text = fs.readFileSync(logFile(), "utf8");
  } catch {
    text = "";
  }
  const lines = text.split("\n");
  // Мишень, если она уже записана: строка «мишень записана: <slug>».
  const m = text.match(/мишень записана:\s*([\w-]+)/);
  return ok({
    running,
    tail: lines.slice(-60).join("\n"),
    lines: lines.length,
    slug: m ? m[1] : "",
  });
}
