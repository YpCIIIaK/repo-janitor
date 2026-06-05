import { describe, it, expect } from "vitest"
import { staleBranchScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("staleBranchScanner", () => {
  it("warns on a branch abandoned ≥180 days and infos one stale ≥90 days", async () => {
    const ctx = makeContext({
      branches: [
        { name: "old", lastCommit: "a", behind: 4, ageDays: 200 },
        { name: "stale", lastCommit: "b", behind: 0, ageDays: 100 },
      ],
    })
    const issues = await staleBranchScanner.run(ctx)
    const old = issues.find((i) => i.id === "branch-stale-old")
    const stale = issues.find((i) => i.id === "branch-stale-stale")
    expect(old?.severity).toBe("warning")
    expect(stale?.severity).toBe("info")
    expect(old?.location).toBe("origin/old")
    expect(old?.detail).toContain("4 commits behind")
  })

  it("does not flag a branch younger than 90 days", async () => {
    const ctx = makeContext({
      branches: [{ name: "fresh", lastCommit: "a", behind: 1, ageDays: 30 }],
    })
    expect(await staleBranchScanner.run(ctx)).toHaveLength(0)
  })

  it("never flags the default branch", async () => {
    const ctx = makeContext({
      repo: { defaultBranch: "main" },
      branches: [{ name: "main", lastCommit: "a", behind: 0, ageDays: 999 }],
    })
    expect(await staleBranchScanner.run(ctx)).toHaveLength(0)
  })

  it("returns nothing when there are no branches", async () => {
    expect(await staleBranchScanner.run(makeContext())).toHaveLength(0)
  })
})
