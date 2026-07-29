import { NextResponse } from "next/server"
import { recordUsage, visitorFrom } from "@/lib/usage"
import { checkRateLimit, clientIp, limitsFromEnv } from "@/lib/scan-limits"

/**
 * Records that somebody opened a shared report.
 *
 * This is the one usage event the server cannot observe on its own. The shared
 * page is server-rendered and must stay readable with no JavaScript, so the
 * visitor id — which lives in the browser — is not available while rendering it.
 * A small beacon after paint is the honest way to get it, and if the beacon is
 * blocked the page is completely unaffected.
 *
 * This is the only write here a client can trigger directly, so it is narrow on
 * purpose: the event name is fixed, the only accepted input is an owner/name pair
 * matched against a strict pattern, and it shares the scan rate-limit budget so
 * it cannot be used to pump rows into the table.
 */
export const runtime = "nodejs"

/** GitHub-ish identifier. Not a general string: this value is stored. */
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/

export async function POST(request: Request) {
  const limits = limitsFromEnv()
  if (!checkRateLimit(clientIp(request, limits.trustedProxyHops), limits).ok) {
    // Silently accepted rather than 429'd: the caller is a fire-and-forget
    // beacon with nothing to retry, and a visible error on a shared page would
    // be noise about a feature the reader did not ask for.
    return NextResponse.json({ ok: true })
  }

  const visitor = visitorFrom(request)
  if (!visitor) return NextResponse.json({ ok: true })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const owner = String((body as { owner?: unknown })?.owner ?? "")
  const name = String((body as { name?: unknown })?.name ?? "")
  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(name)) {
    return NextResponse.json({ error: "Bad repository identity" }, { status: 400 })
  }

  recordUsage({ visitor, event: "share-view", repo: `${owner}/${name}` })
  return NextResponse.json({ ok: true })
}
