import { NextResponse } from "next/server"
import { limitsFromEnv } from "@/lib/scan-limits"

/**
 * What this deployment will actually accept in one scan request.
 *
 * Exists because the form used to guess. It offered twenty repositories while
 * the server was configured for one, so the only way to discover the real limit
 * was to choose three, wait, and be refused — after the work of choosing. A
 * limit the user cannot see is a limit they can only meet by accident.
 *
 * Only the two numbers a caller can already infer by trying: how many URLs per
 * request, and how many scans run at once. Nothing here is a secret — the rate
 * limit and queue depth are deliberately left out, since those are about how
 * hard someone may push and are better discovered by being refused.
 */
export const runtime = "nodejs"

export async function GET() {
  const limits = limitsFromEnv()
  return NextResponse.json(
    {
      maxUrlsPerRequest: limits.maxUrlsPerRequest,
      maxConcurrent: limits.maxConcurrent,
    },
    // Configuration, not data: it changes on redeploy, so a short cache is free.
    { headers: { "cache-control": "public, max-age=300" } },
  )
}
