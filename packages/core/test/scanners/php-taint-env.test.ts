import { describe, it, expect } from "vitest"
import { Env } from "../../src/scanners/php-taint/env"

const join = (envs: Env<string[]>[]) => Env.join(envs, (a, b) => [...new Set([...a, ...b])])

describe("php-taint copy-on-write env", () => {
  it("branches do not see each other's writes, nor leak into the parent", () => {
    const root = new Env<string[]>().set("a", ["1"]).set("b", ["2"])
    const left = root.fork(), right = root.fork()
    left.set("a", ["L"])
    right.delete("b")
    root.set("c", ["3"])
    expect(left.get("a")).toEqual(["L"])
    expect(left.get("b")).toEqual(["2"])
    expect(left.has("c")).toBe(false)
    expect(right.get("a")).toEqual(["1"])
    expect(right.has("b")).toBe(false)
    expect(root.get("a")).toEqual(["1"])
    expect([...root].map(([k]) => k).sort()).toEqual(["a", "b", "c"])
  })

  it("join keeps every value; a key deleted in one branch keeps the other's", () => {
    const root = new Env<string[]>().set("a", ["1"]).set("b", ["2"]).set("c", ["3"])
    const x = root.fork(), y = root.fork()
    x.set("a", ["X"])
    y.set("a", ["Y"])
    x.delete("b")
    x.delete("c")
    y.delete("c")
    y.set("n", [])
    const j = join([x, y])
    expect(j.get("a")?.sort()).toEqual(["X", "Y"])
    expect(j.get("b")).toEqual(["2"])
    expect(j.has("c")).toBe(false)
    expect(j.has("n")).toBe(true)
  })

  it("nested branches and long chains stay correct", () => {
    let cur = new Env<string[]>().set("v0", ["0"])
    for (let i = 1; i < 100; i++) {
      const t = cur.fork(), e = cur.fork()
      t.set(`v${i}`, [`t${i}`])
      const inner = t.fork()
      inner.set("deep", [`${i}`])
      cur = join([join([t, inner]), e])
    }
    expect(cur.get("v0")).toEqual(["0"])
    expect(cur.get("v99")).toEqual(["t99"])
    expect(cur.get("deep")?.length).toBeGreaterThan(1)
    expect(cur.flat().size).toBe(101)
  })
})
