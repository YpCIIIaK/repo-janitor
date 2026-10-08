import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { lookupAiSources, clearAiSourcesCache } from "@/lib/ai-sources"

const id = "GHSA-wq5f-xc86-pv6w"
beforeEach(() => clearAiSourcesCache())
afterEach(() => vi.unstubAllGlobals())

it("fetches the exact advisory once and caches parallel requests", async () => {
  const mock = vi.fn().mockImplementation(async () => Response.json({ id, summary: "librsvg", affected: [] }))
  vi.stubGlobal("fetch", mock)
  const [a, b] = await Promise.all([lookupAiSources(id), lookupAiSources(id)])
  expect(a).toEqual(b)
  expect(a[0]).toMatchObject({ status: "fetched", url: `https://api.osv.dev/v1/vulns/${id}` })
  expect(mock).toHaveBeenCalledTimes(1)
  expect(mock.mock.calls[0][1]).toMatchObject({ redirect: "error" })
})

it.each([404, 429, 500])("reports HTTP %s as unverified and negative-caches it", async (status) => {
  const mock = vi.fn().mockImplementation(async () => new Response("", { status }))
  vi.stubGlobal("fetch", mock)
  expect((await lookupAiSources(id))[0].status).toBe("unavailable")
  await lookupAiSources(id)
  expect(mock).toHaveBeenCalledTimes(1)
})

it("does not treat an unrelated advisory as verification", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "CVE-2025-11111" })))
  expect((await lookupAiSources(id))[0].status).toBe("unavailable")
})

it("follows only a canonical GitHub repository from npm metadata", async () => {
  const mock = vi.fn().mockImplementation(async (url: string) => url.includes("registry.npmjs.org")
    ? Response.json({ name: "sharp", version: "0.35.5", repository: { url: "git+https://github.com/lovell/sharp.git" } })
    : Response.json({ full_name: "lovell/sharp", archived: false, pushed_at: "2026-10-08" }))
  vi.stubGlobal("fetch", mock)
  const out = await lookupAiSources("Finding: sharp is deprecated\nLocation: package.json")
  expect(out).toHaveLength(2)
  expect(mock.mock.calls.map((c) => c[0])).toEqual(["https://registry.npmjs.org/sharp/latest", "https://api.github.com/repos/lovell/sharp"])
  expect(out.every((s) => s.status === "fetched")).toBe(true)
})

it("ignores arbitrary URLs and non-npm findings", async () => {
  const mock = vi.fn()
  vi.stubGlobal("fetch", mock)
  expect(await lookupAiSources("Finding: requests is deprecated\nLocation: requirements.txt\nhttp://127.0.0.1/secrets https://attacker.example")).toEqual([])
  expect(mock).not.toHaveBeenCalled()
})

it("does not follow malicious npm repository links", async () => {
  const mock = vi.fn().mockResolvedValue(Response.json({ name: "sharp", version: "1", repository: { url: "https://github.com.attacker.example/a/b" } }))
  vi.stubGlobal("fetch", mock)
  expect(await lookupAiSources("Finding: sharp is deprecated\nLocation: package.json")).toHaveLength(1)
  expect(mock).toHaveBeenCalledTimes(1)
})

it("bounds advisory lookups and response size", async () => {
  const mock = vi.fn().mockImplementation(async () => new Response("x".repeat(512 * 1024 + 1)))
  vi.stubGlobal("fetch", mock)
  const out = await lookupAiSources(Array.from({ length: 9 }, (_, i) => `CVE-2026-${12340 + i}`).join(" "))
  expect(mock).toHaveBeenCalledTimes(4)
  expect(out.every((s) => s.status === "unavailable")).toBe(true)
})
