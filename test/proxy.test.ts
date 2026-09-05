import { afterEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
afterEach(() => vi.unstubAllEnvs())
it("rejects cross-origin mutations while allowing the configured website", () => {
  vi.stubEnv("PUBLIC_ORIGIN", "https://service.example")
  expect(proxy(new NextRequest("https://service.example/api/unlock", { method: "POST", headers: { origin: "https://attacker.example" } })).status).toBe(403)
  expect(proxy(new NextRequest("https://service.example/api/unlock", { method: "POST", headers: { origin: "https://service.example" } })).status).toBe(200)
})
