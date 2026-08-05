import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  isSecureRequest,
  readSession,
  publicOrigin,
  sessionFromRequest,
} from "@/lib/session"

import {
  accessTokenFrom,
  authorizeUrl,
  createState,
  oauthConfig,
  safeReturnPath,
  statesMatch,
  verifyState,
} from "@/lib/github-oauth"

const SECRET = "test-secret-not-a-real-one"
const NOW = 1_760_000_000_000

describe("createSession / readSession", () => {
  it("round-trips a login", () => {
    const session = readSession(createSession("octocat", SECRET, NOW), SECRET, NOW)
    expect(session?.login).toBe("octocat")
  })

  it("expires", () => {
    const cookie = createSession("octocat", SECRET, NOW)
    const justBefore = NOW + SESSION_TTL_SECONDS * 1000 - 1000
    const justAfter = NOW + SESSION_TTL_SECONDS * 1000 + 1000
    expect(readSession(cookie, SECRET, justBefore)).not.toBeNull()
    expect(readSession(cookie, SECRET, justAfter)).toBeNull()
  })

  it("rejects a tampered payload", () => {
    // The whole point of the signature: a cookie is user-controlled bytes, and
    // editing the login inside it must not promote anybody.
    const cookie = createSession("octocat", SECRET, NOW)
    const [, signature] = cookie.split(".")
    const forged = `${Buffer.from(JSON.stringify({ login: "admin", iat: 1, exp: 9e9 })).toString("base64url")}.${signature}`
    expect(readSession(forged, SECRET, NOW)).toBeNull()
  })

  it("rejects a cookie signed with a different secret", () => {
    expect(readSession(createSession("octocat", "other", NOW), SECRET, NOW)).toBeNull()
  })

  it("refuses everything when the secret is unset", () => {
    // Failing open here would turn a missing env var into an auth bypass.
    const cookie = createSession("octocat", SECRET, NOW)
    expect(readSession(cookie, undefined, NOW)).toBeNull()
    expect(readSession(cookie, "", NOW)).toBeNull()
  })

  it("refuses to mint without a secret", () => {
    expect(() => createSession("octocat", "")).toThrow()
  })

  it("returns null for malformed input rather than throwing", () => {
    for (const bad of ["", ".", "no-separator", "a.b.c", "!!!.???", Buffer.from("{}").toString("base64url")]) {
      expect(readSession(bad, SECRET, NOW)).toBeNull()
    }
  })

  it("rejects a payload that is valid JSON but not a session", () => {
    const payload = Buffer.from(JSON.stringify({ login: 42 })).toString("base64url")
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url")
    expect(readSession(`${payload}.${sig}`, SECRET, NOW)).toBeNull()
  })
})

describe("sessionFromRequest", () => {
  const withCookie = (value: string) =>
    new Request("https://x.test/", { headers: { cookie: value } })

  it("finds the session among other cookies", () => {
    const cookie = createSession("octocat", SECRET, NOW)
    const req = withCookie(`theme=dark; ${SESSION_COOKIE}=${cookie}; other=1`)
    expect(sessionFromRequest(req, SECRET, NOW)?.login).toBe("octocat")
  })

  it("is null with no cookie header at all", () => {
    expect(sessionFromRequest(new Request("https://x.test/"), SECRET, NOW)).toBeNull()
  })

  it("does not confuse a cookie whose name merely ends the same", () => {
    // Must fail on the name, not on expiry — hence passing NOW through.
    const cookie = createSession("octocat", SECRET, NOW)
    expect(sessionFromRequest(withCookie(`not_${SESSION_COOKIE}=${cookie}`), SECRET, NOW)).toBeNull()
    expect(sessionFromRequest(withCookie(`${SESSION_COOKIE}=${cookie}`), SECRET, NOW)).not.toBeNull()
  })
})

describe("isSecureRequest", () => {
  it("trusts the forwarded protocol first, then the URL", () => {
    const withProto = (v: string) =>
      new Request("http://x.test/", { headers: { "x-forwarded-proto": v } })
    expect(isSecureRequest(withProto("https"))).toBe(true)
    // A proxy chain reports the client hop first.
    expect(isSecureRequest(withProto("https,http"))).toBe(true)
    expect(isSecureRequest(withProto("http"))).toBe(false)
    expect(isSecureRequest(new Request("https://x.test/"))).toBe(true)
    expect(isSecureRequest(new Request("http://x.test/"))).toBe(false)
  })
})

describe("publicOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://10.0.0.7:3000/api/auth/github", { headers })

  it("reconstructs the browser's origin from the proxy headers", () => {
    // The bug this exists for: Render terminates TLS, so request.url is the
    // internal http hop. A redirect_uri built from it does not match the one
    // registered on the OAuth app and GitHub refuses the whole sign-in.
    expect(
      publicOrigin(req({ "x-forwarded-proto": "https", "x-forwarded-host": "repo-anti-rot.onrender.com" })),
    ).toBe("https://repo-anti-rot.onrender.com")
  })

  it("takes the client hop from a proxy chain", () => {
    expect(
      publicOrigin(req({ "x-forwarded-proto": "https,http", "x-forwarded-host": "a.test,b.test" })),
    ).toBe("https://a.test")
  })

  it("falls back to the host header, then to the request", () => {
    expect(publicOrigin(req({ host: "localhost:3000" }))).toBe("http://localhost:3000")
    expect(publicOrigin(req({}))).toBe("http://10.0.0.7:3000")
  })

  it("lets configuration win over any header", () => {
    // A header is a guess; configuration is not.
    process.env.PUBLIC_ORIGIN = "https://configured.test/"
    try {
      expect(publicOrigin(req({ "x-forwarded-host": "spoofed.test" }))).toBe("https://configured.test")
    } finally {
      delete process.env.PUBLIC_ORIGIN
    }
  })
})

describe("oauth state", () => {
  it("accepts a state it minted", () => {
    expect(verifyState(createState(SECRET, NOW), SECRET, NOW)).toBe(true)
  })

  it("expires after ten minutes", () => {
    const state = createState(SECRET, NOW)
    expect(verifyState(state, SECRET, NOW + 599_000)).toBe(true)
    expect(verifyState(state, SECRET, NOW + 601_000)).toBe(false)
  })

  it("rejects a forged or foreign state", () => {
    expect(verifyState(createState("other", NOW), SECRET, NOW)).toBe(false)
    expect(verifyState("a.b.c", SECRET, NOW)).toBe(false)
    expect(verifyState("", SECRET, NOW)).toBe(false)
  })

  it("is different every time", () => {
    // A predictable state is not a CSRF defence.
    expect(createState(SECRET, NOW)).not.toBe(createState(SECRET, NOW))
  })

  it("requires the query and cookie copies to match", () => {
    // The signature proves we minted it; the cookie proves it was minted for
    // this browser. An attacker can obtain the first by starting their own flow.
    const mine = createState(SECRET, NOW)
    const theirs = createState(SECRET, NOW)
    expect(statesMatch(mine, mine)).toBe(true)
    expect(statesMatch(mine, theirs)).toBe(false)
    expect(statesMatch(mine, null)).toBe(false)
    expect(statesMatch(null, mine)).toBe(false)
  })
})

describe("safeReturnPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeReturnPath("/watch")).toBe("/watch")
    expect(safeReturnPath("/r/octocat/hello?x=1")).toBe("/r/octocat/hello?x=1")
  })

  it("refuses anything that could leave the site", () => {
    // The classic open redirect: a link that starts on your domain, shows your
    // consent screen, and lands on theirs.
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "evil.test",
      "",
      null,
      undefined,
    ]) {
      expect(safeReturnPath(bad)).toBe("/profile")
    }
  })
})

describe("authorizeUrl", () => {
  it("asks for no scopes", () => {
    // An empty scope still reads public profile data, and a leaked token then
    // grants nothing that was not already public.
    const url = new URL(authorizeUrl("cid", "https://x.test/cb", "st"))
    expect(url.searchParams.get("scope")).toBe("")
    expect(url.searchParams.get("client_id")).toBe("cid")
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/cb")
    expect(url.searchParams.get("state")).toBe("st")
  })
})

describe("accessTokenFrom", () => {
  it("takes the token", () => {
    expect(accessTokenFrom({ access_token: "t", token_type: "bearer" })).toBe("t")
  })

  it("refuses a rejection that arrived as HTTP 200", () => {
    // GitHub answers a failed exchange with 200 and an `error` field; a caller
    // checking only res.ok would try to use the word "undefined" as a token.
    expect(accessTokenFrom({ error: "bad_verification_code" })).toBeNull()
    expect(accessTokenFrom({ error: "x", access_token: "t" })).toBeNull()
  })

  it("refuses junk", () => {
    expect(accessTokenFrom(null)).toBeNull()
    expect(accessTokenFrom("t")).toBeNull()
    expect(accessTokenFrom({ access_token: "" })).toBeNull()
    expect(accessTokenFrom({ access_token: 42 })).toBeNull()
  })
})

describe("oauthConfig", () => {
  it("is null unless both halves are present", () => {
    expect(oauthConfig({})).toBeNull()
    expect(oauthConfig({ GITHUB_OAUTH_CLIENT_ID: "a" })).toBeNull()
    expect(oauthConfig({ GITHUB_OAUTH_CLIENT_SECRET: "b" })).toBeNull()
    expect(
      oauthConfig({ GITHUB_OAUTH_CLIENT_ID: " a ", GITHUB_OAUTH_CLIENT_SECRET: "b" }),
    ).toEqual({ clientId: "a", clientSecret: "b" })
  })
})
