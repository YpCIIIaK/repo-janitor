import { describe, it, expect } from "vitest"
import { parseLogLine, parseLog, selectCommits, type Commit } from "@/lib/commit-sampling"

const US = "\x1f"
const DAY = 24 * 60 * 60 * 1000

/** Build a `git log` line in our `%H%x1f%ct%x1f%P%x1f%D%x1f%s` format. */
function logLine(sha: string, unixSec: number, parents = "", decoration = "", subject = "msg") {
  return [sha, String(unixSec), parents, decoration, subject].join(US)
}

/** A synthetic commit `n` days before `base`, newest at n=0. */
function commit(sha: string, daysAgo: number, opts: Partial<Commit> = {}): Commit {
  return {
    sha,
    date: 1_700_000_000_000 - daysAgo * DAY,
    parents: ["p"],
    subject: sha,
    tagged: false,
    ...opts,
  }
}

describe("parseLogLine", () => {
  it("parses a well-formed line into a Commit", () => {
    const c = parseLogLine(logLine("a".repeat(40), 1700000000, "b1 b2", "tag: v1.0", "feat: x"))
    expect(c).not.toBeNull()
    expect(c!.sha).toBe("a".repeat(40))
    expect(c!.date).toBe(1700000000 * 1000)
    expect(c!.parents).toEqual(["b1", "b2"])
    expect(c!.tagged).toBe(true)
    expect(c!.subject).toBe("feat: x")
  })

  it("keeps a subject that itself contains the separator-free pipe chars", () => {
    const c = parseLogLine(logLine("a".repeat(40), 1700000000, "p", "", "fix: a | b | c"))
    expect(c!.subject).toBe("fix: a | b | c")
  })

  it("treats a root commit (no parents) as non-merge", () => {
    const c = parseLogLine(logLine("a".repeat(40), 1700000000, "", "", "root"))
    expect(c!.parents).toEqual([])
  })

  it("rejects a malformed line", () => {
    expect(parseLogLine("garbage")).toBeNull()
    expect(parseLogLine(["nothex", "x", "", "", "s"].join(US))).toBeNull()
  })
})

describe("parseLog", () => {
  it("drops blank and malformed lines", () => {
    const out = parseLog(
      [logLine("a".repeat(40), 1700000000), "", "  ", "junk", logLine("b".repeat(40), 1699990000)].join("\n"),
    )
    expect(out.map((c) => c.sha)).toEqual(["a".repeat(40), "b".repeat(40)])
  })
})

describe("selectCommits", () => {
  it("returns everything when history fits the budget", () => {
    const cs = [commit("h", 0), commit("m", 5), commit("o", 10)]
    expect(selectCommits(cs, 18).map((c) => c.sha)).toEqual(["h", "m", "o"])
  })

  it("always anchors the newest and oldest commit", () => {
    const cs = Array.from({ length: 50 }, (_, i) => commit(`c${i}`, i))
    const out = selectCommits(cs, 5)
    expect(out).toHaveLength(5)
    expect(out[0].sha).toBe("c0") // newest
    expect(out[out.length - 1].sha).toBe("c49") // oldest
  })

  it("prioritizes tagged and merge commits", () => {
    const cs = Array.from({ length: 30 }, (_, i) =>
      commit(`c${i}`, i, {
        tagged: i === 10,
        parents: i === 20 ? ["p1", "p2"] : ["p"],
      }),
    )
    const shas = selectCommits(cs, 6).map((c) => c.sha)
    expect(shas).toContain("c10") // tag
    expect(shas).toContain("c20") // merge
  })

  it("never exceeds the budget even with many priority commits", () => {
    const cs = Array.from({ length: 40 }, (_, i) => commit(`c${i}`, i, { tagged: true }))
    expect(selectCommits(cs, 8)).toHaveLength(8)
  })

  it("returns a newest-first list with no duplicates", () => {
    const cs = Array.from({ length: 40 }, (_, i) => commit(`c${i}`, i, { tagged: i % 3 === 0 }))
    const out = selectCommits(cs, 12)
    const shas = out.map((c) => c.sha)
    expect(new Set(shas).size).toBe(shas.length)
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].date).toBeGreaterThanOrEqual(out[i].date)
    }
  })

  it("spreads fill picks across weeks rather than clustering", () => {
    // 40 commits, one per day → ~6 distinct weeks. With no tags/merges the fill
    // step should touch multiple weeks, not just the newest.
    const cs = Array.from({ length: 40 }, (_, i) => commit(`c${i}`, i))
    const out = selectCommits(cs, 6)
    const weeks = new Set(out.map((c) => Math.floor(c.date / (7 * DAY))))
    expect(weeks.size).toBeGreaterThan(1)
  })

  it("handles empty input and non-positive budgets", () => {
    expect(selectCommits([], 10)).toEqual([])
    expect(selectCommits([commit("a", 0)], 0)).toEqual([])
  })
})
