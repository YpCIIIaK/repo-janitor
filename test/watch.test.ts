import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { isSignificantDrop, isGrade, gradeWorse } from "@/lib/watch-drop"
import { normalizeWatchEmail, isValidWatchToken, newWatchToken } from "@/lib/watch-tokens"
import { buildDropDigest, buildWelcomeWatch, buildMagicLinkMail } from "@/lib/watch-email"
import { allowRate, resetWatchRate } from "@/lib/watch-rate"
import { subscribeWatch, unsubscribeByToken, listWatchesByManageToken } from "@/lib/watch-store"

describe("watch-tokens", () => {
  it("normalises email", () => {
    expect(normalizeWatchEmail("  You@Example.COM ")).toBe("you@example.com")
    expect(normalizeWatchEmail("nope")).toBeNull()
    expect(normalizeWatchEmail("")).toBeNull()
  })

  it("mints path-safe tokens", () => {
    const t = newWatchToken()
    expect(isValidWatchToken(t)).toBe(true)
    expect(isValidWatchToken("../etc")).toBe(false)
  })
})

describe("watch-drop", () => {
  it("detects grade worsening", () => {
    expect(gradeWorse("B", "C")).toBe(true)
    expect(gradeWorse("C", "B")).toBe(false)
    expect(isSignificantDrop({ grade: "B", score: 80 }, { grade: "C", score: 78 })).toMatchObject({
      dropped: true,
      reason: "grade",
    })
  })

  it("detects score drop by threshold", () => {
    expect(isSignificantDrop({ grade: "B", score: 80 }, { grade: "B", score: 78 }, 3)).toEqual({
      dropped: false,
    })
    expect(isSignificantDrop({ grade: "B", score: 80 }, { grade: "B", score: 76 }, 3)).toMatchObject({
      dropped: true,
      reason: "score",
      delta: 4,
    })
  })

  it("ignores improvements", () => {
    expect(isSignificantDrop({ grade: "C", score: 60 }, { grade: "B", score: 70 })).toEqual({
      dropped: false,
    })
  })

  it("validates grades", () => {
    expect(isGrade("A")).toBe(true)
    expect(isGrade("Z")).toBe(false)
  })
})

describe("watch-email", () => {
  it("builds a drop digest with was→now and commits", () => {
    const mail = buildDropDigest({
      owner: "acme",
      name: "widget",
      prevGrade: "B",
      prevScore: 80,
      nextGrade: "D",
      nextScore: 55,
      critical: 1,
      warning: 2,
      commits: [
        { shortSha: "abc1234", subject: "break deps" },
        { shortSha: "def5678", subject: "remove CI" },
      ],
      scanUrl: "https://x/?url=https://github.com/acme/widget",
      manageUrl: "https://x/watch/tok",
      unsubUrl: "https://x/api/watch?token=u",
    })
    expect(mail.subject).toContain("B 80 → D 55")
    expect(mail.text).toContain("Was:  B 80/100")
    expect(mail.text).toContain("abc1234  break deps")
    expect(mail.html).toContain("break deps")
    expect(mail.html).toContain("Unsubscribe")
  })

  it("includes regression story findings when provided", () => {
    const mail = buildDropDigest({
      owner: "acme",
      name: "widget",
      prevGrade: "A",
      prevScore: 94,
      nextGrade: "C",
      nextScore: 70,
      critical: 2,
      warning: 1,
      commits: [],
      scanUrl: "https://x/",
      manageUrl: "https://x/w",
      unsubUrl: "https://x/u",
      storyHeadline: "A 94 → C 70 (-24) · 2 new",
      newFindings: [
        {
          id: "a",
          title: "Secret in config",
          severity: "critical",
          location: "config.ts",
        },
      ],
    })
    expect(mail.text).toContain("What changed: A 94 → C 70 (-24) · 2 new")
    expect(mail.text).toContain("Secret in config")
    expect(mail.html).toContain("Secret in config")
  })

  it("builds welcome and magic templates", () => {
    expect(buildWelcomeWatch({
      owner: "a",
      name: "b",
      grade: "A",
      score: 90,
      manageUrl: "https://x/w",
      unsubUrl: "https://x/u",
    }).subject).toContain("Watching a/b")
    expect(buildMagicLinkMail({ manageUrl: "https://x/w", count: 2 }).text).toContain("Open your watches")
  })
})

describe("watch-rate", () => {
  beforeEach(() => resetWatchRate())
  it("allows up to max then blocks", () => {
    expect(allowRate("k", 2, 60_000, 1000)).toBe(true)
    expect(allowRate("k", 2, 60_000, 1001)).toBe(true)
    expect(allowRate("k", 2, 60_000, 1002)).toBe(false)
  })
})

describe("watch-store filesystem", () => {
  const prevUrl = process.env.SUPABASE_URL
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = prevUrl
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey
  })

  it("upserts by email+repo and reuses manage token", async () => {
    const email = `watch-test-${Date.now()}@example.com`
    const first = await subscribeWatch({
      email,
      owner: "Acme",
      name: "Widget",
      repoUrl: "https://github.com/acme/widget",
      grade: "B",
      score: 77,
      issueIds: ["issue-a", "issue-b"],
    })
    expect(first.created).toBe(true)
    expect(first.managePath).toMatch(/^\/watch\//)
    expect(first.subscription.lastIssueIds).toEqual(["issue-a", "issue-b"])

    const second = await subscribeWatch({
      email,
      owner: "Acme",
      name: "Widget",
      repoUrl: "https://github.com/acme/widget",
      grade: "A",
      score: 90,
    })
    expect(second.created).toBe(false)
    expect(second.managePath).toBe(first.managePath)
    expect(second.subscription.lastScore).toBe(90)

    const other = await subscribeWatch({
      email,
      owner: "Acme",
      name: "Other",
      repoUrl: "https://github.com/acme/other",
      grade: "C",
      score: 60,
    })
    expect(other.managePath).toBe(first.managePath)

    const list = await listWatchesByManageToken(first.subscription.manageToken)
    expect(list.length).toBeGreaterThanOrEqual(2)

    expect(await unsubscribeByToken(first.subscription.unsubToken)).toBe(true)
    expect(await unsubscribeByToken(first.subscription.unsubToken)).toBe(false)
  })
})
