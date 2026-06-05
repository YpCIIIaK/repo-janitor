import { NextResponse } from "next/server"
import { scanReportSchema } from "@/packages/core/src/schema"
import { upsertServerReport, type ScanReport } from "@/lib/server-store"
import { notifyScoreDrop } from "@/lib/webhook"

/**
 * Report ingestion endpoint.
 *
 * CI (the GitHub Action in `packages/action`) POSTs a `ScanReport` here. We
 * validate it against the shared zod schema — the single source of truth —
 * persist it to the server store, and acknowledge. The dashboard reads it back
 * via `/api/reports` and merges it into its view (ROADMAP D1/D3).
 */
export const runtime = "nodejs"

/**
 * Optional shared-secret auth. When `REPO_ANTI_ROT_INGEST_TOKEN` is set, callers must
 * send `Authorization: Bearer <token>`. When unset (local dev), auth is skipped.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.REPO_ANTI_ROT_INGEST_TOKEN
  if (!expected) return true
  const header = request.headers.get("authorization") ?? ""
  const token = header.replace(/^Bearer\s+/i, "")
  return token === expected
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = scanReportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Report failed schema validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const report = parsed.data
  let previous: ScanReport | null = null
  try {
    ;({ previous } = await upsertServerReport(report as ScanReport))
  } catch (err) {
    // Read-only filesystem (e.g. some serverless hosts) — surface clearly.
    return NextResponse.json(
      { error: `Failed to persist report: ${String(err)}` },
      { status: 500 },
    )
  }

  // Best-effort alert when health regressed vs the previous scan (opt-in via env).
  await notifyScoreDrop(previous, report as ScanReport)

  return NextResponse.json({
    ok: true,
    repo: `${report.repo.owner}/${report.repo.name}`,
    score: report.score,
    grade: report.grade,
    issues: report.issues.length,
    receivedAt: new Date().toISOString(),
  })
}
