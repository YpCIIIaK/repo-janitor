import { afterEach, expect, it, vi } from "vitest"
import { checkBearer } from "@/lib/api-auth"
import { isPublicGitUrl } from "@/lib/url-guard"
afterEach(() => vi.unstubAllEnvs())

it("fails closed for unconfigured API tokens on a public deployment", () => {
  vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "true")
  expect(checkBearer(new Request("https://service/api/ingest"), undefined)).toBe(false)
})
it("rejects user-controlled clone hosts and credentials on public deployments", async () => {
  vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "true")
  vi.stubEnv("REPO_ANTI_ROT_GIT_HOSTS", "github.com")
  const resolver = async () => ["1.1.1.1"]
  expect((await isPublicGitUrl("https://attacker.example/repo", resolver)).ok).toBe(false)
  expect((await isPublicGitUrl("https://user:password@github.com/a/b", resolver)).ok).toBe(false)
  expect((await isPublicGitUrl("https://github.com/a/b", resolver)).ok).toBe(true)
})
