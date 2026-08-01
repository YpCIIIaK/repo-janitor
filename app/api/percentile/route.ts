import { NextResponse } from "next/server"
import { percentileFor } from "@/lib/percentile"
import { SIZE_BUCKETS, type SizeBucket } from "@/lib/scan-stats"

/**
 * Where a score stands against everything scanned.
 *
 *   GET /api/percentile?score=67&language=TypeScript&size=m
 *   → { betterThan: 71, sample: 412, basis: "language-size" }
 *   → { betterThan: null } when there is not enough to say
 *
 * Public and unauthenticated, because the answer is an aggregate: it says
 * nothing about any individual repository, which is the whole point of how the
 * table behind it is built (see `lib/scan-stats.ts`).
 *
 * Every input is attacker-supplied and is treated that way — the score is
 * clamped to 0–100, the size must be one of the known buckets, and the language
 * is length-capped before it reaches a query filter. None of them can widen what
 * the endpoint returns, which is one number and a count.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Long enough for any language name `detectTools`/`extToLanguage` produces. */
const MAX_LANGUAGE = 40

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  // The emptiness check comes first and separately. `Number(null)` and
  // `Number("")` are both 0, which is finite — so a request with no score at all
  // would have been answered with the percentile of zero, the most alarming
  // number available, for a repository nobody asked about.
  const scoreParam = params.get("score")?.trim()
  if (!scoreParam) {
    return NextResponse.json({ error: "score is required" }, { status: 400 })
  }
  const raw = Number(scoreParam)
  if (!Number.isFinite(raw)) {
    return NextResponse.json({ error: "score must be a number" }, { status: 400 })
  }
  const score = Math.min(100, Math.max(0, Math.round(raw)))

  const sizeParam = params.get("size")
  const size = SIZE_BUCKETS.includes(sizeParam as SizeBucket) ? (sizeParam as SizeBucket) : undefined

  const langParam = params.get("language")?.trim() ?? ""
  // A filter value is interpolated into a PostgREST query string, so anything
  // that is not a plain language name is dropped rather than escaped.
  const language = /^[\w+#. -]{1,40}$/.test(langParam) && langParam.length <= MAX_LANGUAGE
    ? langParam
    : undefined

  const hit = await percentileFor(score, { language, size })

  return NextResponse.json(
    hit
      ? { betterThan: hit.betterThan, worseThan: hit.worseThan, sample: hit.sample, basis: hit.basis }
      : { betterThan: null },
    // Cacheable for a minute: the distribution moves slowly, and this endpoint
    // is hit once per rendered report.
    { headers: { "Cache-Control": "public, max-age=60" } },
  )
}
