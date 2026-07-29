import { NextResponse } from "next/server"
import { scanReportSchema } from "@/packages/core/src/schema"
import { toSharedReport } from "@/lib/share-report"
import { putShare } from "@/lib/share-store"
import type { ScanReport } from "@/lib/server-store"
import { checkRateLimit, clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { isPublicGitUrl } from "@/lib/url-guard"

/**
 * Create a share link for a scan result.
 *
 * Called only when the user ticks the consent box. The client POSTs the full
 * report it already holds; the server reduces it to the publishable projection
 * (lib/share-report.ts) and stores that. The reduction happens HERE rather than
 * in the browser on purpose — a client could otherwise post a payload of its own
 * design and have us publish it under our domain.
 *
 * Rate-limited on the same budget as scanning: this writes to disk on behalf of
 * anonymous callers, which is the other way to fill a volume.
 */
export const runtime = "nodejs"

export async function POST(request: Request) {
  const limits = limitsFromEnv()
  const rate = checkRateLimit(clientIp(request, limits.trustedProxyHops), limits)
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${rate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Validate against the same schema /api/ingest uses: a share link should never
  // be able to publish something that is not a real report.
  const parsed = scanReportSchema.safeParse((body as { report?: unknown })?.report)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Report failed schema validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  // The repo URL is stored so the shared page can offer a fresh scan. Re-checked
  // here rather than trusted: this value ends up on a public page and is handed
  // straight back to the scanner, so a private or internal address must not be
  // able to make the round trip through a share link.
  const rawRepoUrl = String((body as { repoUrl?: unknown })?.repoUrl ?? "").trim()
  let repoUrl: string | undefined
  if (rawRepoUrl) {
    const safe = await isPublicGitUrl(rawRepoUrl)
    if (safe.ok) repoUrl = rawRepoUrl
  }

  const shared = toSharedReport(parsed.data as ScanReport, repoUrl)

  let token: string
  try {
    ;({ token } = await putShare(shared))
  } catch (err) {
    // Read-only filesystem, or the shareability guard tripped.
    return NextResponse.json({ error: `Failed to store share: ${String(err)}` }, { status: 500 })
  }

  const { owner, name } = shared.repo
  return NextResponse.json({
    token,
    path: `/r/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${token}`,
  })
}
