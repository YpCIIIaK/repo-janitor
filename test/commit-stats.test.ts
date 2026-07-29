import { describe, it, expect } from "vitest"
import { parseLogWithStats, COMMIT_RS } from "@/lib/commit-sampling"

/** Build one `git log --name-status` record the way git emits it. */
function record(
  sha: string,
  ct: number,
  subject: string,
  nameStatus: string[],
  opts: { parents?: string; refs?: string } = {},
) {
  const header = [sha, String(ct), opts.parents ?? "", opts.refs ?? "", subject].join("\x1f")
  return `${COMMIT_RS}${header}\n${nameStatus.join("\n")}\n`
}

describe("parseLogWithStats", () => {
  it("reads a commit's message and which files it touched", () => {
    const out = parseLogWithStats(
      record("a".repeat(40), 1_700_000_000, "fix: stop the leak", [
        "M\tsrc/a.ts",
        "D\tsrc/b.ts",
        "A\tsrc/c.ts",
      ]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].subject).toBe("fix: stop the leak")
    expect(out[0].filesChanged).toBe(3)
    expect(out[0].files).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "deleted" },
      { path: "src/c.ts", status: "added" },
    ])
  })

  /**
   * A rename prints three fields, not two. Splitting naively yields a path of
   * "old" — a file that no longer exists — which is worse than no data.
   */
  it("takes the destination name of a rename", () => {
    const out = parseLogWithStats(
      record("b".repeat(40), 1_700_000_000, "move it", ["R096\tsrc/old.ts\tsrc/new.ts"]),
    )
    expect(out[0].files).toEqual([{ path: "src/new.ts", status: "renamed" }])
  })

  it("caps the file list but keeps the total honest", () => {
    const many = Array.from({ length: 50 }, (_, i) => `M\tsrc/f${i}.ts`)
    const out = parseLogWithStats(record("c".repeat(40), 1_700_000_000, "big change", many))
    expect(out[0].files).toHaveLength(20)
    expect(out[0].truncated).toBe(true)
    // The count covers all 50 files, not just the 20 listed.
    expect(out[0].filesChanged).toBe(50)
  })

  it("survives subjects containing separator-like text", () => {
    const out = parseLogWithStats(
      record("d".repeat(40), 1_700_000_000, "docs: describe a\\tb formatting", ["M\tREADME.md"]),
    )
    expect(out[0].subject).toBe("docs: describe a\\tb formatting")
    expect(out[0].files).toHaveLength(1)
  })

  it("reads several commits and marks merges and tags", () => {
    const dump =
      record("e".repeat(40), 1_700_000_000, "merge branch", ["M\ta.ts"], {
        parents: `${"f".repeat(40)} ${"0".repeat(40)}`,
      }) + record("f".repeat(40), 1_699_000_000, "release", ["M\tb.ts"], { refs: "tag: v1.2.0" })

    const out = parseLogWithStats(dump)
    expect(out).toHaveLength(2)
    expect(out[0].parents).toHaveLength(2)
    expect(out[1].tagged).toBe(true)
  })

  it("reports a commit that changed no files rather than dropping it", () => {
    const out = parseLogWithStats(record("1".repeat(40), 1_700_000_000, "empty commit", []))
    expect(out).toHaveLength(1)
    expect(out[0].files).toEqual([])
    expect(out[0].filesChanged).toBe(0)
    expect(out[0].truncated).toBe(false)
  })
})
