import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installWindow } from "./helpers"
import { clearShareHandle, saveShareHandle } from "@/lib/share-handle"
import { refreshPublishedShare } from "@/lib/share-refresh"

const report = {
  schemaVersion: 1,
  repo: { owner: "acme", name: "widget", defaultBranch: "main" },
  generatedAt: "2026-08-01T12:00:00.000Z",
  score: 88,
  grade: "B",
  issues: [],
}

describe("refreshPublishedShare", () => {
  beforeEach(() => {
    installWindow()
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      configurable: true,
    })
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    clearShareHandle("acme", "widget")
    vi.unstubAllGlobals()
  })

  it("skips when there is no manage handle", async () => {
    await expect(refreshPublishedShare(report)).resolves.toBe("skipped")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts manageKey and persists the updated handle", async () => {
    saveShareHandle({
      token: "tok1234567890abcd",
      manageKey: "mgr1234567890abcdxx",
      owner: "acme",
      name: "widget",
      path: "https://example.com/r/acme/widget/tok1234567890abcd",
      updatedAt: "2026-07-01T00:00:00.000Z",
    })

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "tok1234567890abcd",
          manageKey: "mgr1234567890abcdxx",
          path: "/r/acme/widget/tok1234567890abcd",
          updatedAt: "2026-08-01T12:00:00.000Z",
          created: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(refreshPublishedShare(report, "https://github.com/acme/widget")).resolves.toBe(
      "updated",
    )

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.method).toBe("POST")
    const body = JSON.parse(String(init?.body))
    expect(body.manageKey).toBe("mgr1234567890abcdxx")
    expect(body.report.repo.name).toBe("widget")
  })

  it("returns failed when the API rejects", async () => {
    saveShareHandle({
      token: "tok1234567890abcd",
      manageKey: "mgr1234567890abcdxx",
      owner: "acme",
      name: "widget",
      path: "https://example.com/r/acme/widget/tok1234567890abcd",
      updatedAt: "2026-07-01T00:00:00.000Z",
    })
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 403 }))
    await expect(refreshPublishedShare(report)).resolves.toBe("failed")
  })
})
