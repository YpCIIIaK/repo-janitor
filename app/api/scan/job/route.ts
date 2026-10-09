import { NextResponse } from "next/server"
import { getScanJob } from "@/lib/scan-jobs"

export const runtime = "nodejs"
export async function GET(request: Request) {
  const id = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
  const headers = { "Cache-Control": "no-store", "Vary": "Authorization" }
  try {
    let job = await getScanJob(id)
    if (!job) return NextResponse.json({ error: "Scan job expired or was lost after a server restart. Start a new scan." }, { status: 404, headers })
    if (job.archiveInfo && ["completed", "failed"].includes(job.status)) {
      job = await getScanJob(id, true)
      if (!job) return NextResponse.json({ error: "The report retention period expired. Check your browser copy or run a new scan." }, { status: 404, headers })
    }
    const { worker: _worker, ...publicJob } = job
    void _worker
    return NextResponse.json(publicJob, { headers })
  } catch {
    return NextResponse.json({ error: "Could not read scan status. Try reconnecting shortly." }, { status: 503, headers })
  }
}
