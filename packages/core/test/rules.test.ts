import { describe, expect, it } from "vitest"
import { ruleLabel, ruleOf } from "../src/rules"

describe("ruleOf", () => {
  it.each([
    ["secret-history-aws-key-a.ts@abc", "secret-history"],
    ["secret-entropy-a.ts:3", "secret-generic"],
    ["secret-openai-key-a.ts:3", "secret-provider"],
    ["insecure-weak-hash-src/a.ts:9", "insecure-weak-hash"],
    ["insecure-py-yaml-load-x.py:1", "insecure-py-yaml-load"],
    ["action-unpinned-.github/workflows/ci.yml-4", "workflow-action-unpinned"],
    ["dep-unused-lodash", "dep-unused"],
    ["eol-runner-.github/workflows/ci.yml-3", "eol-runner"],
    ["skiptest-a.test.ts:4", "skipped-test"],
    ["deadlink-404-https://x", "dead-link"],
    ["deadlink-unverified-https://x", "dead-link-unverified"],
  ])("%s → %s", (id, rule) => {
    expect(ruleOf({ id })).toBe(rule)
    expect(ruleLabel(rule)).toBeTruthy()
  })

  it("falls back to the scanner", () => {
    expect(ruleOf({ id: "something-new", scanner: "x-scanner" })).toBe("x-scanner")
  })
})
