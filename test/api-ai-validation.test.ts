import { afterEach, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/complete/route"
import { clearAiSourcesCache } from "@/lib/ai-sources"
afterEach(() => vi.unstubAllGlobals())
it("uses direct sources without a paid plugin and disables Nemotron reasoning", async () => {
  clearAiSourcesCache()
  const id = "GHSA-wq5f-xc86-pv6w"
  const fetchMock = vi.fn().mockImplementation(async (url: string) => url.startsWith("https://api.osv.dev/")
    ? Response.json({ id, summary: "Exact advisory" })
    : Response.json({ choices: [{ finish_reason: "stop", message: { content: "1: Upgrade now." } }] }))
  vi.stubGlobal("fetch", fetchMock)
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify({ apiKey: "test", model: "nvidia/nemotron-3.5-lightning:free", prompt: id, web: true }) }))
  expect(response.status).toBe(200)
  expect((await response.json()).sources[0]).toMatchObject({ status: "fetched", label: `OSV ${id}` })
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body)
  expect(payload.plugins).toBeUndefined()
  expect(payload.reasoning).toEqual({ enabled: false, exclude: true })
  expect(payload.messages.at(-1).content).toContain("Exact advisory")
})

it("refuses the paid :online model shortcut", async () => {
  const mock = vi.fn()
  vi.stubGlobal("fetch", mock)
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify({ apiKey: "test", model: "test:online", prompt: "test" }) }))
  expect(response.status).toBe(400)
  expect(mock).not.toHaveBeenCalled()
})
it.each([
  { finish_reason: "length", message: { content: "Upgrade" } },
  { finish_reason: "stop", message: { content: "1. **Analyze the User's Request:**" } },
  { finish_reason: "stop", message: { content: null, reasoning: "hidden thoughts" } },
  { finish_reason: "stop", message: { content: [] } },
])("rejects invalid upstream completions: %j", async (choice) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [choice] })))
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify({ apiKey: "test", model: "test", prompt: "test" }) }))
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ code: "invalid_completion" })
})

it("requests separate reasoning and returns only a completed answer", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: " Keep it. ", reasoning: "hidden" } }] }))
  vi.stubGlobal("fetch", fetchMock)
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify({ apiKey: "test", model: "test", prompt: "test" }) }))
  expect(await response.json()).toEqual({ text: "Keep it." })
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: "low", exclude: true })
})
it.each([null, [], { apiKey: 123 }, { prompt: {} }, { maxTokens: "a lot" }, { web: "yes" }])("rejects malformed AI requests without contacting the provider: %j", async (body) => {
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify(body) }))
  expect(response.status).toBe(400)
  expect(fetchMock).not.toHaveBeenCalled()
})
