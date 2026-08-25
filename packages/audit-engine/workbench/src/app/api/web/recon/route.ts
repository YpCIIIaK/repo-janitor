/* Discovery-картина для UI: карта приложения + стек + CVE-кандидаты.

   Гоняет webrecon.py (агрегатор webmap/webfinger/webcve) синхронно — блоки
   быстрые и только читают. Результат кэшируется в recon.json; GET отдаёт кэш,
   POST пересобирает. Пассивно, GET-only к мишени, в пределах allow. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { fail, ok, readJson } from "@/lib/http";
import { workspaceRoot } from "@/lib/paths";
import { webSiteDir } from "@/lib/webPaths";
import { getWebTarget } from "@/lib/webTargets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const run = promisify(execFile);

function python() {
  if (process.env.AUDITSCOUT_PYTHON) return process.env.AUDITSCOUT_PYTHON;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const p = path.join(local, "Programs", "Python", "Python313", "python.exe");
    if (fs.existsSync(p)) return p;
  }
  return "python";
}

export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") || "";
  if (!slug) return fail("нужен slug");
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(webSiteDir(slug), "recon.json"), "utf8"));
    return ok(cached);
  } catch {
    return ok({ slug, map: { assets: [] }, tech: [], cve: { candidates: [], skipped: [], candidate_count: 0 }, cached: false });
  }
}

export async function POST(req: Request) {
  const b = await readJson<{ slug?: string }>(req);
  const slug = (b.slug || "").trim();
  if (!slug) return fail("нужен slug");
  const t = getWebTarget(slug);
  if (!t) return fail("сначала добавь сайт в /web/sites");
  const host = (t.hosts || [])[0];
  if (!host) return fail("нет хоста в скоупе");

  const allowArgs = (t.hosts || []).flatMap((h) => ["--allow", h]);
  try {
    const { stdout } = await run(
      python(),
      ["webrecon.py", `https://${host}/`, ...allowArgs],
      { cwd: workspaceRoot(), timeout: 90_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    const data = JSON.parse(stdout);
    data.at = new Date().toISOString();
    fs.writeFileSync(path.join(webSiteDir(slug), "recon.json"), JSON.stringify(data, null, 1), "utf8");
    return ok(data);
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 300) : "recon не удался");
  }
}
