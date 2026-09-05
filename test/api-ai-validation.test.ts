import { afterEach, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/complete/route"
afterEach(() => vi.unstubAllGlobals())
it.each([null, [], { apiKey: 123 }, { prompt: {} }, { maxTokens: "a lot" }, { web: "yes" }])("rejects malformed AI requests without contacting the provider: %j", async (body) => {
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  const response = await POST(new Request("https://local/api/ai/complete", { method: "POST", body: JSON.stringify(body) }))
  expect(response.status).toBe(400)
  expect(fetchMock).not.toHaveBeenCalled()
})
