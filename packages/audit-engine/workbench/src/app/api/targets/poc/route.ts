/* Запуск poc.py прямо из UI: форк-PoC гейт «verified или killed» по одному
   кандидату. Форк mainnet ТОЛЬКО ЧТЕНИЕ (poc.py createSelectFork, ни одной
   live-транзакции). Долго (компиляция + форк) — процесс отвязан от запроса,
   вывод течёт в data/bounty/<slug>/ui-poc.log, страница опрашивает GET.
   Исход (dust/profit/revert/no_delta) poc.py сам кладёт в gate_memory.json,
   и он всплывает в панели мишени с бейджем [poc]. Foundry-PATH poc.py
   добавляет сам (_forge_env). */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fail, ok, readJson } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";

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

function logFile(slug: string) {
  const dir = path.join(workspaceRoot(), "data", "bounty", slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "ui-poc.log");
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const SIG = /^[A-Za-z_]\w*\([^)]*\)$/; // my2Wei(address)

export async function POST(req: Request) {
  const b = await readJson<{
    slug?: string; target?: string; sig?: string;
    args?: string; asset?: string; key?: string;
  }>(req);
  const slug = (b.slug || "").trim();
  const target = (b.target || "").trim();
  const sig = (b.sig || "").trim();
  const asset = (b.asset || "").trim();
  const argv = (b.args || "").trim();
  const key = (b.key || "").trim();
  if (!slug) return fail("нужен slug");
  if (!ADDR.test(target)) return fail("target: нужен адрес 0x… (40 hex)");
  if (!SIG.test(sig)) return fail("sig: нужна сигнатура вида my2Wei(address)");
  if (!ADDR.test(asset)) return fail("asset: нужен адрес токена 0x… для замера дельты");
  if (running.has(slug)) return ok({ started: false, running: true });

  const a = ["poc.py", "--target", target, "--sig", sig, "--asset", asset, "--slug", slug];
  if (argv) a.push("--args", argv);
  if (key) a.push("--key", key, "--label", key);

  const file = logFile(slug);
  fs.writeFileSync(file, `$ poc.py --target ${target} --sig "${sig}" --asset ${asset}\n`, "utf8");
  const out = fs.openSync(file, "a");
  const child = spawn(python(), a, {
    cwd: workspaceRoot(),
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  running.set(slug, child.pid ?? -1);
  child.on("exit", (code) => {
    running.delete(slug);
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
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!slug) return fail("нужен slug");
  let text = "";
  try {
    text = fs.readFileSync(logFile(slug), "utf8");
  } catch {
    text = "";
  }
  const lines = text.split("\n");
  return ok({ running: running.has(slug), tail: lines.slice(-40).join("\n"), lines: lines.length });
}
