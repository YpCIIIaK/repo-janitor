import { NextResponse } from "next/server"
import { limitsFromEnv } from "@/lib/scan-limits"
import { isOwner } from "@/lib/owner"
import { MAX_CLONE_BYTES, SCAN_HEAP_MB } from "@/lib/clone-runner"

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
      // So the form can judge a repository's size against the real ceiling
      // instead of a number guessed in the client.
      maxCloneMb: Math.round(MAX_CLONE_BYTES / (1024 * 1024)),
      scanHeapMb: SCAN_HEAP_MB,
      owner,
    },
    // Not cached at all. The answer depends on who is asking, and it changes the
    // moment they unlock — a cached "max 1" survived the unlock and made the
    // form keep refusing work the server would have accepted. One tiny request
    // per page load is a fair price for an answer that is never stale.
    { headers: { "cache-control": "no-store" } },
  )
}
