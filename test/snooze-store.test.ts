import { describe, it, expect, afterEach, vi } from "vitest"
import {
  snoozeKey,
  partitionSnoozed,
  setSnoozed,
  clearSnoozedForRepo,
} from "@/lib/snooze-store"
import { issue, installWindow } from "./helpers"

afterEach(() => vi.unstubAllGlobals())

const KEY = "repo-anti-rot:snoozed:v1"

describe("snoozeKey", () => {
  it("namespaces an issue id under its repo", () => {
    expect(snoozeKey("acme/widget", "i1")).toBe("acme/widget::i1")
  })
})

describe("partitionSnoozed", () => {
  it("splits issues into live and muted by the snoozed set", () => {
    const issues = [issue({ id: "a" }), issue({ id: "b" }), issue({ id: "c" })]
    const snoozed = new Set([snoozeKey("r", "b")])
    const { live, muted } = partitionSnoozed("r", issues, snoozed)
    expect(live.map((i) => i.id)).toEqual(["a", "c"])
    expect(muted.map((i) => i.id)).toEqual(["b"])
  })

  it("keys snoozes per repo, so the same id elsewhere stays live", () => {
    const snoozed = new Set([snoozeKey("other", "a")])
    const { live, muted } = partitionSnoozed("r", [issue({ id: "a" })], snoozed)
    expect(live).toHaveLength(1)
    expect(muted).toHaveLength(0)
  })
})

describe("setSnoozed", () => {
  it("adds and removes a key idempotently", () => {
    const storage = installWindow()
    setSnoozed("r", "a", true)
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(["r::a"])
    setSnoozed("r", "a", true) // no duplicate
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(["r::a"])
    setSnoozed("r", "a", false)
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual([])
  })

  it("dispatches a change event so the hook re-renders", () => {
    installWindow()
    const seen = vi.fn()
    window.addEventListener("repo-anti-rot:snoozed:changed", seen)
    setSnoozed("r", "a", true)
    expect(seen).toHaveBeenCalledOnce()
  })
})

describe("clearSnoozedForRepo", () => {
  it("drops only the target repo's snoozes", () => {
    const storage = installWindow()
    setSnoozed("r1", "a", true)
    setSnoozed("r1", "b", true)
    setSnoozed("r2", "a", true)
    clearSnoozedForRepo("r1")
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(["r2::a"])
  })

  it("is a no-op when nothing matches", () => {
    const storage = installWindow()
    setSnoozed("r2", "a", true)
    clearSnoozedForRepo("r1")
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(["r2::a"])
  })
})
