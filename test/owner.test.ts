import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

import { OWNER_COOKIE, isOwner, isOwnerToken, ownerKeyConfigured } from "@/lib/owner"

const KEY = "b3f1c0d9e8a7462fbc1d5e0a9f8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b"

const withCookie = (value: string) =>
  new Request("https://example.test/api/scan", {
    method: "POST",
    headers: { cookie: value },
  })

describe("owner key", () => {
  const saved = process.env.REPO_ANTI_ROT_OWNER_TOKEN

  beforeEach(() => {
    process.env.REPO_ANTI_ROT_OWNER_TOKEN = KEY
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.REPO_ANTI_ROT_OWNER_TOKEN
    else process.env.REPO_ANTI_ROT_OWNER_TOKEN = saved
  })

  it("recognises the configured key", () => {
    expect(isOwnerToken(KEY)).toBe(true)
    expect(isOwner(withCookie(`${OWNER_COOKIE}=${KEY}`))).toBe(true)
  })

  it("rejects a wrong key", () => {
    expect(isOwnerToken(`${KEY.slice(0, -1)}c`)).toBe(false)
    expect(isOwner(withCookie(`${OWNER_COOKIE}=nope`))).toBe(false)
  })

  it("nobody is the owner when no key is configured", () => {
    // The dangerous default would be the other way round: an operator who never
    // set the variable would be handing out unlimited access to everyone.
    delete process.env.REPO_ANTI_ROT_OWNER_TOKEN
    expect(ownerKeyConfigured()).toBe(false)
    expect(isOwnerToken("")).toBe(false)
    expect(isOwnerToken(KEY)).toBe(false)
    expect(isOwner(withCookie(`${OWNER_COOKIE}=`))).toBe(false)
  })

  it("is not fooled by an empty or absent cookie", () => {
    expect(isOwner(new Request("https://example.test/"))).toBe(false)
    expect(isOwner(withCookie(""))).toBe(false)
    expect(isOwner(withCookie(`${OWNER_COOKIE}=`))).toBe(false)
  })

  it("finds its cookie among others, and is not confused by a similar name", () => {
    expect(isOwner(withCookie(`rar_locale=ru; ${OWNER_COOKIE}=${KEY}; other=1`))).toBe(true)
    expect(isOwner(withCookie(`not_${OWNER_COOKIE}=${KEY}`))).toBe(false)
    expect(isOwner(withCookie(`${OWNER_COOKIE}_x=${KEY}`))).toBe(false)
  })

  it("handles a percent-encoded cookie value", () => {
    process.env.REPO_ANTI_ROT_OWNER_TOKEN = "a b/c"
    expect(isOwner(withCookie(`${OWNER_COOKIE}=${encodeURIComponent("a b/c")}`))).toBe(true)
  })
})
