import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The Stop button is only worth having if it stops the *server*. Aborting the
 * fetch on its own ends the progress bar while the route keeps cloning and
 * scanning — with "every commit" that is up to 250 scans nobody is waiting for,
 * on a box small enough that it matters.
 *
 * These drive the route directly and assert the per-commit loop actually ends.
 * `vi.mock` is hoisted above the imports, so the route is imported statically —
 * a top-level `await import` would need target ES2017+ and this tsconfig
 * targets ES6.
 */
vi.mock("server-only", () => ({}))

const scanned: string[] = []

vi.mock("@/lib/clone-runner", () => ({
  CLI_DIST: "/fake/cli.js",
  MAX_CLONE_BYTES: 1_000_000_000,
  SIZE_POLL_MS: 100_000,
  dirSizeExceeds: async () => false,
  run: async (cmd: string, args: string[]) => {
    if (cmd === "git" && args.includes("clone")) return { code: 0, stdout: "", stderr: "" }
    if (cmd === "git" && args.includes("log")) {
      // Ten commits, newest first: sha \x1f epoch \x1f parents \x1f refs \x1f subject
      const lines = Array.from({ length: 10 }, (_, i) =>
        [`${"a".repeat(39)}${i}`, String(1_700_000_000 - i * 86_400), "", "", `commit ${i}`].join(
          "\x1f",
        ),
      )
      return { code: 0, stdout: lines.join("\n"), stderr: "" }
    }
    if (cmd === "git" && args.includes("checkout")) {
      scanned.push(args[args.length - 1])
      return { code: 0, stdout: "", stderr: "" }
    }
    return { code: 0, stdout: "", stderr: "" }
  },
}))

vi.mock("@/lib/scan-cache", () => ({
  getCachedScan: async () => null,
  putCachedScan: async () => {},
}))

vi.mock("@/lib/url-guard", () => ({
  isPublicGitUrl: async () => ({ ok: true }),
}))

vi.mock("fs/promises", async (orig) => {
  const actual = await orig<typeof import("fs/promises")>()
  return {
    ...actual,
    mkdtemp: async () => "/tmp/fake",
    rm: async () => {},
    readFile: async () => JSON.stringify({ issues: [{ id: "i1" }] }),
  }
})

import { POST } from "@/app/api/scan/history/route"

beforeEach(() => {
  scanned.length = 0
})

function post(body: unknown) {
  return POST(new Request("http://localhost/api/scan/history", { method: "POST", body: JSON.stringify(body) }))
}

describe("POST /api/scan/history — cancellation", () => {
  it("stops scanning commits once the client cancels the stream", async () => {
    const res = await post({ url: "https://github.com/acme/widget.git", all: true })
    const reader = res.body!.getReader()

    // Read just enough to know the run has started, then walk away.
    await reader.read()
    await reader.cancel()

    // Give the loop a chance to notice and finish whatever was in flight.
    await new Promise((r) => setTimeout(r, 200))
    const afterCancel = scanned.length

    await new Promise((r) => setTimeout(r, 300))
    // The count must not keep climbing: that is the difference between a Stop
    // button and a Hide button.
    expect(scanned.length).toBe(afterCancel)
    expect(scanned.length).toBeLessThan(10)
  })

  it("scans every commit when nobody cancels", async () => {
    // The control case — without it the test above would pass on a route that
    // never scans anything at all.
    const res = await post({ url: "https://github.com/acme/widget.git", all: true })
    const reader = res.body!.getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(scanned.length).toBe(10)
  })
})
