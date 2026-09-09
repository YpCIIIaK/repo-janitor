import { afterEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
afterEach(() => vi.unstubAllEnvs())
it("rejects cross-origin mutations while allowing the configured website", () => {
  vi.stubEnv("PUBLIC_ORIGIN", "https://service.example")
  expect(proxy(new NextRequest("https://service.example/api/unlock", { method: "POST", headers: { origin: "https://attacker.example" } })).status).toBe(403)
  expect(proxy(new NextRequest("https://service.example/api/unlock", { method: "POST", headers: { origin: "https://service.example" } })).status).toBe(200)
})

it("treats localhost loopback spellings as the same local origin", () => {
  vi.stubEnv("PUBLIC_ORIGIN", "http://localhost:3000")
  expect(proxy(new NextRequest("http://127.0.0.1:3000/api/scan", {
    method: "POST", headers: { origin: "http://127.0.0.1:3000" },
  })).status).toBe(200)
  expect(proxy(new NextRequest("http://localhost:3001/api/scan", {
    method: "POST", headers: { origin: "http://localhost:3001" },
  })).status).toBe(403)
})

it("does not allow a loopback origin for a configured public deployment", () => {
  vi.stubEnv("PUBLIC_ORIGIN", "https://repo-janitor.app")
  expect(proxy(new NextRequest("https://repo-janitor.app/api/scan", {
    method: "POST", headers: { origin: "http://127.0.0.1:3000" },
  })).status).toBe(403)
})
