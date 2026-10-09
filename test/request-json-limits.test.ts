import { describe, it, expect } from "vitest"
import { MAX_ARRAY_LENGTH, oversizedArray, readJson } from "@/lib/request-json"

const req = (body: string) => new Request("http://x/api", { method: "POST", body })

describe("readJson array cap (zod CVE-2023-54404 mitigation)", () => {
  it("rejects the CVE's payload: a huge array of empty objects, nested in a report", async () => {
    const issues = "[" + Array.from({ length: 300_000 }, () => "{}").join(",") + "]"
    await expect(readJson(req(`{"report":{"issues":${issues}}}`), 2 * 1024 * 1024)).rejects.toThrow(
      /\$\.report\.issues is longer than/,
    )
  })

  it("accepts a realistic report", async () => {
    const issues = Array.from({ length: 1500 }, (_, i) => ({ id: `x${i}`, severity: "info" }))
    const body = await readJson(req(JSON.stringify({ report: { issues } })), 2 * 1024 * 1024)
    expect((body as { report: { issues: unknown[] } }).report.issues).toHaveLength(1500)
  })

  it("finds oversized arrays at any depth", () => {
    expect(oversizedArray({ a: [{ b: new Array(MAX_ARRAY_LENGTH + 1).fill(0) }] })).toBe("$.a[0].b")
    expect(oversizedArray({ a: new Array(MAX_ARRAY_LENGTH).fill(0) })).toBeNull()
  })
})
