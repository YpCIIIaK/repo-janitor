import { db, ftsRebuild } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/http";
import { importTracks, normalizeSlug, scaffoldTrack } from "@/lib/import";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    importTracks();
  } catch {
    /* disk scan optional */
  }
  const rows = db()
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM findings f WHERE f.project_id = p.id) AS findings_count,
        (SELECT COUNT(*) FROM hotspots h WHERE h.project_id = p.id) AS hotspots_count
       FROM projects p ORDER BY p.updated_at DESC`
    )
    .all();
  return ok(rows);
}

export async function POST(req: Request) {
  const b = await readJson<{
    slug: string;
    title: string;
    status?: string;
    platform?: string;
    program_url?: string;
    notes?: string;
  }>(req);
  if (!b.slug || !b.title) return fail("slug и title обязательны");
  const slug = normalizeSlug(b.slug);
  if (!slug) return fail("slug пустой после нормализации");
  try {
    const disk = scaffoldTrack({
      slug,
      title: b.title.trim(),
      platform: b.platform,
      program_url: b.program_url,
      status: b.status || "active",
    });
    importTracks();
    db()
      .prepare(
        `UPDATE projects SET platform = ?, program_url = ?, status = ?, updated_at = datetime('now')
         WHERE slug = ?`
      )
      .run(b.platform || "", b.program_url || "", b.status || "active", slug);
    ftsRebuild();
    const row = db().prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
    return ok({ ...((row as object) || {}), disk }, 201);
  } catch (e) {
    return fail(String(e), 409);
  }
}
