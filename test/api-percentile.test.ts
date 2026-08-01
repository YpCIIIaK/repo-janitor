import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const percentileFor = vi.fn()
vi.mock("@/lib/percentile", () => ({
  percentileFor: (...args: unknown[]) => percentileFor(...args),
}))

import { GET } from "@/app/api/percentile/route"

/**
 * The percentile endpoint is public and every parameter on it comes from
 * whoever called. These tests are about that boundary rather than the maths,
 * which is covered in `scan-stats.test.ts`: what reaches `percentileFor` after a
 * hostile query string, and what comes back when there is nothing to say.
 */

const call = (qs: string) => GET(new Request(`https://x.test/api/percentile?${qs}`))

beforeEach(() => {
  percentileFor.mockReset()
  percentileFor.mockResolvedValue({ betterThan: 71, worseThan: 25, sample: 412, basis: "all" })
})

describe("GET /api/percentile", () => {
  it("returns the position and the sample it came from", async () => {
    const body = await (await call("score=67")).json()
    expect(body).toEqual({ betterThan: 71, worseThan: 25, sample: 412, basis: "all" })
  })

  it("rejects a non-numeric score", async () => {
    expect((await call("score=abc")).status).toBe(400)
    expect((await call("")).status).toBe(400)
  })

  it("clamps a score outside the scale", async () => {
    await call("score=999")
    expect(percentileFor).toHaveBeenCalledWith(100, expect.anything())
    await call("score=-40")
    expect(percentileFor).toHaveBeenCalledWith(0, expect.anything())
  })

  it("passes through a known size bucket", async () => {
    await call("score=50&size=m")
    expect(percentileFor).toHaveBeenCalledWith(50, { language: undefined, size: "m" })
  })

  it("drops a size that is not one of the buckets", async () => {
    await call("score=50&size=enormous")
    expect(percentileFor).toHaveBeenCalledWith(50, { language: undefined, size: undefined })
  })

  it("passes through an ordinary language name", async () => {
    await call("score=50&language=C%2B%2B")
    expect(percentileFor).toHaveBeenCalledWith(50, { language: "C++", size: undefined })
  })

  it("drops a language that is not a language name", async () => {
    // The value is interpolated into a PostgREST filter, so anything unexpected
    // is dropped rather than escaped.
    for (const bad of ["TypeScript*", "a,b", "x)or(1", "'", "a".repeat(60)]) {
      percentileFor.mockClear()
      await call(`score=50&language=${encodeURIComponent(bad)}`)
      expect(percentileFor).toHaveBeenCalledWith(50, { language: undefined, size: undefined })
    }
  })

  it("says nothing rather than guessing when there is too little data", async () => {
    percentileFor.mockResolvedValue(null)
    expect(await (await call("score=50")).json()).toEqual({ betterThan: null })
  })

  it("is cacheable, because the distribution moves slowly", async () => {
    const res = await call("score=50")
    expect(res.headers.get("Cache-Control")).toMatch(/max-age=60/)
  })
})
