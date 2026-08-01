import { describe, it, expect } from "vitest"
import {
  parseSharePath,
  badgeUrl,
  badgeMarkdown,
  cardMarkdown,
  embedSnippet,
  embedUrl,
  EMBED_HEIGHT,
  EMBED_WIDTH,
} from "@/lib/badge-markdown"

const ORIGIN = "https://anti-rot.example.com"

describe("parseSharePath", () => {
  it("reads a full share URL", () => {
    expect(parseSharePath(`${ORIGIN}/r/acme/widget/aBcD1234efGh5678`)).toEqual({
      owner: "acme",
      name: "widget",
      token: "aBcD1234efGh5678",
    })
  })

  it("reads a bare path", () => {
    expect(parseSharePath("/r/acme/widget/tok_123-456")).toMatchObject({ token: "tok_123-456" })
  })

  it("decodes an escaped owner or name", () => {
    expect(parseSharePath("/r/my%20org/my%20repo/tok123")).toMatchObject({
      owner: "my org",
      name: "my repo",
    })
  })

  it("rejects anything that is not a share path", () => {
    for (const bad of ["/app", "/r/acme/widget", `${ORIGIN}/`, "not a url at all", ""]) {
      expect(parseSharePath(bad)).toBeNull()
    }
  })

  it("rejects a token with characters a token cannot have", () => {
    // The token shape is enforced at the store too; keeping it here means a
    // malformed one never reaches a README as a broken image.
    expect(parseSharePath("/r/acme/widget/../../etc/passwd")).toBeNull()
    expect(parseSharePath("/r/acme/widget/tok.123")).toBeNull()
  })
})

describe("badgeUrl", () => {
  it("carries the token as a query parameter", () => {
    expect(badgeUrl(ORIGIN, { owner: "acme", name: "widget", token: "tok123" })).toBe(
      `${ORIGIN}/api/badge/acme/widget?token=tok123`,
    )
  })

  it("escapes an owner or name with a space", () => {
    expect(badgeUrl(ORIGIN, { owner: "my org", name: "my repo", token: "t" })).toBe(
      `${ORIGIN}/api/badge/my%20org/my%20repo?token=t`,
    )
  })

  it("does not double the slash on an origin with a trailing one", () => {
    expect(badgeUrl(`${ORIGIN}/`, { owner: "a", name: "b", token: "t" })).toBe(
      `${ORIGIN}/api/badge/a/b?token=t`,
    )
  })
})

describe("badgeMarkdown", () => {
  it("builds a badge that links to the full report", () => {
    // Clickable on purpose: a bare grade invites "says who?", and the answer
    // should be one click away rather than taken on trust.
    expect(badgeMarkdown(ORIGIN, `${ORIGIN}/r/acme/widget/tok123`)).toBe(
      `[![Repo Anti-Rot](${ORIGIN}/api/badge/acme/widget?token=tok123)](${ORIGIN}/r/acme/widget/tok123)`,
    )
  })

  it("returns null rather than half a badge for an unusable link", () => {
    expect(badgeMarkdown(ORIGIN, "/app")).toBeNull()
  })
})

describe("embedSnippet", () => {
  it("builds an iframe pointing at /embed/…", () => {
    expect(embedUrl(ORIGIN, { owner: "acme", name: "widget", token: "tok123" })).toBe(
      `${ORIGIN}/embed/acme/widget/tok123`,
    )
    const html = embedSnippet(ORIGIN, `${ORIGIN}/r/acme/widget/tok123`)
    expect(html).toContain(`src="${ORIGIN}/embed/acme/widget/tok123"`)
    expect(html).toContain(`width="${EMBED_WIDTH}"`)
    expect(html).toContain(`height="${EMBED_HEIGHT}"`)
    expect(html).toContain("loading=\"lazy\"")
  })

  it("escapes quotes in the title attribute", () => {
    const html = embedSnippet(ORIGIN, `${ORIGIN}/r/acme/wid%22get/tok123`)
    expect(html).toContain('title="Repo Anti-Rot — acme/wid&quot;get"')
    expect(html).not.toContain('title="Repo Anti-Rot — acme/wid"get"')
  })

  it("returns null for a non-share URL", () => {
    expect(embedSnippet(ORIGIN, "/app")).toBeNull()
    expect(cardMarkdown(ORIGIN, "/app")).toBeNull()
  })
})
