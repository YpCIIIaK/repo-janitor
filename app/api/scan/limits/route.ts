import { NextResponse } from "next/server"
import { limitsFromEnv } from "@/lib/scan-limits"
import { isOwner } from "@/lib/owner"

/**
 * Ceiling shown to the operator. Not infinity: each URL is a clone, and a form
 * that lets you queue a thousand is a way to wedge your own instance by
 * accident. High enough never to be in the way, low enough to be a guardrail.
 */
const OWNER_MAX_URLS = 100

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

export async function GET(request: Request) {
  const limits = limitsFromEnv()
  // Answered for the caller, not in the abstract: the owner is exempt from the
  // per-request cap, so telling them the public number would make the form
  // refuse work the server would happily accept.
  const owner = isOwner(request)
  return NextResponse.json(
    {
      maxUrlsPerRequest: owner ? OWNER_MAX_URLS : limits.maxUrlsPerRequest,
      maxConcurrent: limits.maxConcurrent,
      owner,
    },
    // Per-caller now, so it must not be cached in a shared proxy — the owner's
    // answer landing in a stranger's browser would show them a limit that does
    // not apply to them.
    { headers: { "cache-control": "private, max-age=60" } },
  )
}
