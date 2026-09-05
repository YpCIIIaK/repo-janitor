import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
vi.mock("server-only", () => ({}))
import { hostedTriage } from "@/lib/hosted-triage"
let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rar-ai-test-"))
  vi.stubEnv("REPO_ANTI_ROT_DATA_DIR", dir)
  vi.stubEnv("OPENROUTER_MODEL", "configured/model")
  vi.stubEnv("OPENROUTER_API_KEY", "test-key")
  vi.stubEnv("REPO_ANTI_ROT_AI_DAILY_REQUESTS", "1")
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})
it("deduplicates requests, caches the result and enforces a persisted daily cap", async () => {
  const upstream = vi.fn(async () => Response.json({ choices: [{ message: { content: "Verify the dependency update with tests." } }] }))
  vi.stubGlobal("fetch", upstream)
  const [first, second] = await Promise.all([hostedTriage("one", "en"), hostedTriage("one", "en")])
  expect(first).toBe(second)
  expect(await hostedTriage("one", "en")).toBe(first)
  expect(upstream).toHaveBeenCalledTimes(1)
  await expect(hostedTriage("different", "en")).rejects.toThrow("allowance")
  expect(JSON.parse(await readFile(join(dir, "ai-budget.json"), "utf8")).count).toBe(1)
  expect(upstream).toHaveBeenCalledTimes(1)
})
it("reserves the budget even if a provider request fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })))
  await expect(hostedTriage("one", "en")).rejects.toThrow("unavailable")
  await expect(hostedTriage("two", "en")).rejects.toThrow("allowance")
})
