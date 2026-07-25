import { NextResponse } from "next/server"
import { readServerRepos } from "@/lib/server-store"
import { checkBearer } from "@/lib/api-auth"

/**
 * Read path for ingested reports. The dashboard fetches this on load and merges
 * the results into its local store, so reports POSTed from CI show up in the UI
 * without any change to the presentational components.
 *
 * Full reports include file paths and (redacted) evidence, so reads are
 * optionally gated: when `REPO_ANTI_ROT_READ_TOKEN` is set, callers must send
 * `Authorization: Bearer <token>`. Default-off so the public dashboard keeps
 * working; enable it for headless/programmatic deployments where the browser
 * isn't the consumer. (The badge endpoint stays open — it exposes only grade +
 * score and is embedded as an <img>.)
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic" // always read the latest store, never cache

export async function GET(request: Request) {
  if (!checkBearer(request, process.env.REPO_ANTI_ROT_READ_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const repos = await readServerRepos()
  return NextResponse.json({ repos })
}
