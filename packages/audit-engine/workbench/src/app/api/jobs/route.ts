import { db } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { parseScanJson } from "@/lib/jsonImport";
import { enqueuePrograms } from "@/lib/pipeline";
import { pumpRunner, runnerState } from "@/lib/jobRunner";

export const dynamic = "force-dynamic";

export function GET() {
  const runner = runnerState();
  if (!runner.paused) void pumpRunner();
  const jobs = db().prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT 250`).all();
  const counts = db().prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all() as {
    status: string;
    n: number;
  }[];
  return ok({ jobs, counts, runner });
}

export async function POST(req: Request) {
  const b = await readJson<{
    slugs?: string[];
    titles?: Record<string, string>;
    json?: unknown;
    text?: string;
    skipReported?: boolean;
  }>(req);
  let slugs = b.slugs || [];
  let titles = b.titles || {};
  let programsIngested = 0;
  if (b.json != null || b.text) {
    const parsed = parseScanJson(b.json ?? b.text);
    slugs = [...slugs, ...parsed.slugs];
    titles = { ...parsed.titles, ...titles };
    programsIngested = parsed.programsIngested;
  }
  if (!slugs.length) return fail("нужны slugs[] или json/text");
  const queued = enqueuePrograms(slugs, titles, { skipReported: b.skipReported !== false });
  return ok({ queued, parsed: slugs.length, programsIngested });
}
