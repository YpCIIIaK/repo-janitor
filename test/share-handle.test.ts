import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installWindow } from "./helpers"
import {
  clearShareHandle,
  loadShareHandle,
  repoFromReport,
  saveShareHandle,
} from "@/lib/share-handle"

describe("share-handle", () => {
  beforeEach(() => {
    installWindow()
  })

  afterEach(() => {
    clearShareHandle("acme", "widget")
    vi.unstubAllGlobals()
  })

  it("round-trips a handle in localStorage", () => {
    saveShareHandle({
      token: "tok1234567890abcd",
      manageKey: "mgr1234567890abcdxx",
      owner: "Acme",
      name: "Widget",
      path: "https://example.com/r/Acme/Widget/tok1234567890abcd",
      updatedAt: "2026-08-01T12:00:00.000Z",
    })
    expect(loadShareHandle("acme", "widget")).toMatchObject({
      token: "tok1234567890abcd",
      manageKey: "mgr1234567890abcdxx",
    })
    clearShareHandle("ACME", "widget")
    expect(loadShareHandle("acme", "widget")).toBeNull()
  })

  it("reads owner/name from a report", () => {
    expect(repoFromReport({ repo: { owner: "a", name: "b" } })).toEqual({
      owner: "a",
      name: "b",
    })
    expect(repoFromReport({})).toBeNull()
  })
})
