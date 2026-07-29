import { describe, it, expect } from "vitest"
import { describeFailure, SCAN_HEAP_MB } from "@/lib/clone-runner"

const result = (over: Partial<{ code: number | null; stderr: string }> = {}) => ({
  code: 1,
  stdout: "",
  stderr: "",
  ...over,
})

/** What the CLI actually writes while working. */
const PROGRESS = [
  '@@PROGRESS@@{"completed":0,"total":19}',
  '@@PROGRESS@@{"scanner":"env-lifecycle","completed":1,"total":19}',
  '@@PROGRESS@@{"scanner":"stale-branch","completed":2,"total":19}',
  '@@PROGRESS@@{"scanner":"todo-debt","completed":3,"total":19}',
].join("\n")

describe("describeFailure", () => {
  it("never shows progress lines as an error", () => {
    // The reported bug: a scanner killed mid-run left stderr full of progress
    // and nothing else, so the user was shown a wall of @@PROGRESS@@ JSON and no
    // hint of what had happened.
    const message = describeFailure(result({ code: null, stderr: PROGRESS }))
    expect(message).not.toContain("@@PROGRESS@@")
    expect(message).not.toContain("completed")
  })

  it("names running out of memory, from the child's own words", () => {
    const message = describeFailure(
      result({
        code: 134,
        stderr: `${PROGRESS}\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`,
      }),
    )
    expect(message).toContain("too large")
    expect(message).toContain(String(SCAN_HEAP_MB))
  })

  it("explains a kill with no output at all", () => {
    // SIGKILL from the platform or the timeout: exit code null, stderr empty or
    // progress-only. "exit null" tells nobody anything.
    for (const code of [null, 137, 134]) {
      const message = describeFailure(result({ code, stderr: PROGRESS }))
      expect(message).toMatch(/out of memory or time/)
    }
  })

  it("keeps a real error, and takes the end rather than the start", () => {
    const message = describeFailure(
      result({ stderr: `${PROGRESS}\nError: ENOENT: no such file or directory` }),
    )
    expect(message).toContain("ENOENT")
  })

  it("bounds the length, so one runaway line cannot fill the page", () => {
    expect(describeFailure(result({ stderr: "x".repeat(10_000) })).length).toBeLessThan(450)
  })

  it("falls back to the exit code when there is nothing to quote", () => {
    expect(describeFailure(result({ code: 2, stderr: "" }))).toBe("scan failed (exit 2)")
  })
})
