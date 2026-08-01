import { describe, it, expect } from "vitest"
import {
  hashManageKey,
  isValidShareKey,
  newManageKey,
  repoKeyOf,
  verifyManageKey,
} from "@/lib/share-keys"

describe("share keys", () => {
  it("mints URL-safe manage keys", () => {
    const key = newManageKey()
    expect(isValidShareKey(key)).toBe(true)
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("verifies against the stored hash only", () => {
    const key = newManageKey()
    const hash = hashManageKey(key)
    expect(verifyManageKey(key, hash)).toBe(true)
    expect(verifyManageKey(newManageKey(), hash)).toBe(false)
    expect(verifyManageKey("", hash)).toBe(false)
    expect(verifyManageKey(key, "")).toBe(false)
  })

  it("normalises repo keys", () => {
    expect(repoKeyOf({ owner: "Acme", name: "Widget" })).toBe("acme/widget")
    expect(repoKeyOf({ owner: " acme ", name: " widget " })).toBe("acme/widget")
  })
})
