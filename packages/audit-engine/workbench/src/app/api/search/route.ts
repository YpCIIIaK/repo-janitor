import { db } from "@/lib/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return ok({ hits: [] });
  const like = `%${q}%`;
  const hits: Record<string, unknown>[] = [];

  const docs = db()
    .prepare(
      `SELECT id, kind, title, substr(body, 1, 200) AS snip FROM documents
       WHERE title LIKE ? OR body LIKE ? LIMIT 40`
    )
    .all(like, like) as { id: number; kind: string; title: string; snip: string }[];
  for (const x of docs) hits.push({ origin: `doc:${x.kind}`, origin_id: x.id, title: x.title, snip: x.snip });

  const finds = db()
    .prepare(
      `SELECT id, title, substr(body, 1, 200) AS snip FROM findings
       WHERE title LIKE ? OR body LIKE ? LIMIT 20`
    )
    .all(like, like) as { id: number; title: string; snip: string }[];
  for (const x of finds) hits.push({ origin: "finding", origin_id: x.id, title: x.title, snip: x.snip });

  const hs = db()
    .prepare(
      `SELECT id, code, title, verdict FROM hotspots
       WHERE title LIKE ? OR verdict LIKE ? OR body LIKE ? LIMIT 20`
    )
    .all(like, like, like) as { id: number; code: string; title: string; verdict: string }[];
  for (const x of hs) hits.push({ origin: "hotspot", origin_id: x.id, title: `${x.code} ${x.title}`, snip: x.verdict });

  const projs = db()
    .prepare(
      `SELECT id, title, substr(notes, 1, 200) AS snip FROM projects
       WHERE title LIKE ? OR slug LIKE ? OR notes LIKE ? OR stopped_at LIKE ? LIMIT 10`
    )
    .all(like, like, like, like) as { id: number; title: string; snip: string }[];
  for (const x of projs) hits.push({ origin: "project", origin_id: x.id, title: x.title, snip: x.snip });

  return ok({ hits });
}
