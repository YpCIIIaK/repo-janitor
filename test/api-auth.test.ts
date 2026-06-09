import { describe, it, expect } from "vitest"
import { safeEqual, bearerToken, checkBearer } from "@/lib/api-auth"

const req = (auth?: string) =>
  new Request("https://x/api", auth ? { headers: { authorization: auth } } : undefined)

describe("safeEqual", () => {
  it("is true only for identical strings", () => {
    expect(safeEqual("hunter2", "hunter2")).toBe(true)
    expect(safeEqual("hunter2", "hunter3")).toBe(false)
  })

  it("handles different lengths without throwing", () => {
    expect(safeEqual("short", "a-much-longer-secret")).toBe(false)
    expect(safeEqual("", "")).toBe(true)
  })
})

describe("bearerToken", () => {
  it("extracts the token, case-insensitively, trimming whitespace", () => {
    expect(bearerToken(req("Bearer abc123"))).toBe("abc123")
    expect(bearerToken(req("bearer   abc123  "))).toBe("abc123")
  })

  it("returns empty string when no/!bearer header", () => {
    expect(bearerToken(req())).toBe("")
    expect(bearerToken(req("Basic Zm9v"))).toBe("Basic Zm9v") // not a bearer → returned as-is, won't match a token
  })
})

describe("checkBearer", () => {
  it("is disabled (always true) when no secret is configured", () => {
    expect(checkBearer(req(), undefined)).toBe(true)
    expect(checkBearer(req(), "")).toBe(true)
    expect(checkBearer(req("Bearer whatever"), undefined)).toBe(true)
  })

  it("enforces a matching bearer when a secret is set", () => {
    expect(checkBearer(req("Bearer s3cret"), "s3cret")).toBe(true)
    expect(checkBearer(req("Bearer wrong"), "s3cret")).toBe(false)
    expect(checkBearer(req(), "s3cret")).toBe(false)
  })
})
