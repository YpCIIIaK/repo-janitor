import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/auth/github/callback/route"
import { createState, STATE_COOKIE } from "@/lib/github-oauth"
import { readSession } from "@/lib/session"
const secret = "oauth-watch-test"
beforeEach(() => {
  vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "client")
  vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "test-secret")
  vi.stubEnv("REPO_ANTI_ROT_SESSION_SECRET", secret)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function signIn(emails: unknown) {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "temporary-test-token", token_type: "bearer" }))
    .mockResolvedValueOnce(Response.json({ login: "octocat" }))
    .mockResolvedValueOnce(Response.json(emails))
  vi.stubGlobal("fetch", fetcher)
  const state = createState(secret)
  const response = await GET(new Request(`http://localhost/api/auth/github/callback?code=test&state=${state}`, { headers: { cookie: `${STATE_COOKIE}=${state}` } }))
  const value = response.headers.get("set-cookie")?.match(/rar_session=([^;]+)/)?.[1]
  expect(response.status).toBe(302)
  return readSession(value, secret)
}
describe("verified watch email from OAuth", () => {
  it("carries only the verified primary email in the signed session", async () => {
    const session = await signIn([{ email: "other@example.com", verified: true, primary: false }, { email: "Owner@Example.com", verified: true, primary: true }])
    expect(session).toMatchObject({ login: "octocat", verifiedEmail: "owner@example.com" })
  })
  it("does not authorize an unverified primary address", async () => {
    const session = await signIn([{ email: "victim@example.com", verified: false, primary: true }])
    expect(session?.login).toBe("octocat")
    expect(session?.verifiedEmail).toBeUndefined()
  })
})
