import { NextResponse } from "next/server"
import { scanReportSchema } from "@/packages/core/src/schema"
import { toSharedReport } from "@/lib/share-report"
import { publishShare, revokeShare } from "@/lib/share-store"
import type { ScanReport } from "@/lib/server-store"
import { checkRateLimit, clientIp, limitsFromEnv } from "@/lib/scan-limits"
import { isPublicGitUrl } from "@/lib/url-guard"
import { recordUsage, visitorFrom } from "@/lib/usage"

/**
 * Publish, refresh, rotate or revoke a share link.
 *
 * POST — create or update the live share for a repo. With a matching manage key
 * the public token stays the same so README badges keep working; `rotate: true`
 * mints a new public token when the old URL must die.
 *
 * DELETE — revoke. Requires the manage key from the browser that published.
 *
 * The client POSTs the full report it already holds; the server reduces it to
 * the publishable projection (lib/share-report.ts) and stores that. Reduction
 * happens HERE on purpose — a client must not be able to publish an arbitrary
 * payload under our domain.
 */
export const runtime = "nodejs"

function rateLimited(request: Request) {
  const limits = limitsFromEnv()
  const rate = checkRateLimit(clientIp(request, limits.trustedProxyHops), limits)
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Try again in ${rate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    )
  }
  return null
}

export async function POST(request: Request) {
  const limited = rateLimited(request)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = scanReportSchema.safeParse((body as { report?: unknown })?.report)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Report failed schema validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const rawRepoUrl = String((body as { repoUrl?: unknown })?.repoUrl ?? "").trim()
  let repoUrl: string | undefined
  if (rawRepoUrl) {
    const safe = await isPublicGitUrl(rawRepoUrl)
    if (safe.ok) repoUrl = rawRepoUrl
  }

  const manageKey =
    typeof (body as { manageKey?: unknown })?.manageKey === "string"
      ? String((body as { manageKey: string }).manageKey).trim()
      : undefined
  const rotate = (body as { rotate?: unknown })?.rotate === true

  const shared = toSharedReport(parsed.data as ScanReport, repoUrl)
  const result = await publishShare(shared, { manageKey, rotate })

  if (!result.ok) {
    const status = result.code === "missing_key" ? 409 : 403
    return NextResponse.json({ error: result.message, code: result.code }, { status })
  }

  const { owner, name } = result.share.report.repo
  const visitor = visitorFrom(request)
  if (visitor) {
    recordUsage({
      visitor,
      event: result.created ? "share-create" : rotate ? "share-rotate" : "share-update",
      repo: `${owner}/${name}`,
    })
  }

  return NextResponse.json({
    token: result.share.token,
    manageKey: result.manageKey,
    path: `/r/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${result.share.token}`,
    created: result.created,
    updatedAt: result.share.updatedAt,
  })
}

export async function DELETE(request: Request) {
  const limited = rateLimited(request)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const manageKey =
    typeof (body as { manageKey?: unknown })?.manageKey === "string"
      ? String((body as { manageKey: string }).manageKey).trim()
      : ""
  const token =
    typeof (body as { token?: unknown })?.token === "string"
      ? String((body as { token: string }).token).trim()
      : undefined
  const owner =
    typeof (body as { owner?: unknown })?.owner === "string"
      ? String((body as { owner: string }).owner).trim()
      : undefined
  const name =
    typeof (body as { name?: unknown })?.name === "string"
      ? String((body as { name: string }).name).trim()
      : undefined

  if (!manageKey || (!token && !(owner && name))) {
    return NextResponse.json(
      { error: "Provide manageKey and either token or owner+name." },
      { status: 400 },
    )
  }

  const result = await revokeShare({ token, manageKey, owner, name })
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 403
    return NextResponse.json({ error: result.message, code: result.code }, { status })
  }

  const visitor = visitorFrom(request)
  if (visitor) {
    recordUsage({
      visitor,
      event: "share-revoke",
      repo: owner && name ? `${owner}/${name}` : undefined,
    })
  }

  return NextResponse.json({ ok: true })
}
