import { expect, it } from "vitest"
import { readJson } from "@/lib/request-json"

it("rejects a chunked body that exceeds its budget without Content-Length", async () => {
  const req = new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) })
  await expect(readJson(req, 20)).rejects.toThrow("too large")
})
it("parses valid bounded JSON", async () => {
  expect(await readJson(new Request("http://localhost/api", { method: "POST", body: '{"ok":true}' }))).toEqual({ ok: true })
})
