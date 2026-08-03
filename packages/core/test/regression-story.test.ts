import { describe, it, expect } from "vitest"
import {
  buildRegressionStory,
  formatStoryHeadline,
  toStoryIssues,
} from "../src/regression-story"

describe("toStoryIssues", () => {
  it("drops incomplete rows", () => {
    expect(
      toStoryIssues([
        { id: "a", title: "ok", severity: "warning", location: "x.ts" },
        { id: "b", title: "no sev" },
        { severity: "critical", title: "no id" },
      ]),
    ).toEqual([{ id: "a", title: "ok", severity: "warning", location: "x.ts" }])
  })
})

describe("buildRegressionStory", () => {
  const baseline = {
    score: 90,
    grade: "A",
    issueIds: ["old-1", "old-2"],
  }

  it("counts added and fixed and lists new findings by severity", () => {
    const story = buildRegressionStory(baseline, {
      score: 78,
      grade: "C",
      issues: [
        { id: "old-1", title: "kept", severity: "info", location: "a.ts" },
        { id: "new-w", title: "warn new", severity: "warning", location: "b.ts" },
        { id: "new-c", title: "crit new", severity: "critical", location: "c.ts" },
      ],
    })
    expect(story.scoreDelta).toBe(-12)
    expect(story.added).toBe(2)
    expect(story.fixed).toBe(1) // old-2 gone
    expect(story.newFindings.map((f) => f.id)).toEqual(["new-c", "new-w"])
    expect(story.headline).toContain("A 90 → C 78 (-12)")
    expect(story.headline).toContain("2 new")
    expect(story.headline).toContain("1 fixed")
  })

  it("caps new findings", () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({
      id: `n-${i}`,
      title: `t${i}`,
      severity: "info" as const,
      location: "x",
    }))
    const story = buildRegressionStory(
      { score: 100, issueIds: [] },
      { score: 90, grade: "A", issues },
      { newCap: 3 },
    )
    expect(story.added).toBe(8)
    expect(story.newFindings).toHaveLength(3)
  })

  it("handles a flat rescan", () => {
    const story = buildRegressionStory(
      { score: 94, grade: "A", issueIds: ["a"] },
      {
        score: 94,
        grade: "A",
        issues: [{ id: "a", title: "same", severity: "info", location: "x" }],
      },
    )
    expect(story.headline).toContain("no change")
    expect(story.newFindings).toHaveLength(0)
  })
})

describe("formatStoryHeadline", () => {
  it("works without a previous grade", () => {
    expect(
      formatStoryHeadline({
        prevScore: 80,
        nextGrade: "B",
        nextScore: 85,
        scoreDelta: 5,
        added: 0,
        fixed: 1,
      }),
    ).toBe("80 → B 85 (+5) · 1 fixed")
  })
})
