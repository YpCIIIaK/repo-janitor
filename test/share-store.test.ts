import { describe, it, expect, vi, beforeEach } from "vitest"
import { isValidShareToken, newShareToken } from "@/lib/share-store"

vi.mock("server-only", () => ({}))

/**
 * Token handling. The token is the only untrusted input that reaches a
 * filesystem path, so its shape is the security boundary — validated, never
 * sanitised, because sanitising invites arguing about which escapes are enough.
 */
describe("share tokens", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("generates unguessable, URL-safe tokens", () => {
    const token = newShareToken()
    expect(isValidShareToken(token)).toBe(true)
    // base64url of 12 bytes: no padding, no characters needing escaping.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(16)
  })

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newShareToken()))
    expect(tokens.size).toBe(500)
  })

  it.each([
    ["../../etc/passwd", "path traversal"],
    ["..", "parent directory"],
    ["a/b", "separator"],
    ["a\\b", "windows separator"],
    ["token.json", "dot"],
    ["", "empty"],
    ["short", "too short to be unguessable"],
    ["x".repeat(200), "absurdly long"],
    ["tok en1234567890", "space"],
    ["tok%2Fen1234567890", "encoded separator"],
  ])("rejects %s (%s)", (candidate) => {
    expect(isValidShareToken(candidate)).toBe(false)
  })

  it("accepts a token of the shape we actually mint", () => {
    for (let i = 0; i < 50; i++) expect(isValidShareToken(newShareToken())).toBe(true)
  })
})
