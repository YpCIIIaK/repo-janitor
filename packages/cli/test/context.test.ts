import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SimpleGit } from "simple-git"
import { buildScanContext, getRepoMetadata } from "../src/context"

/**
 * Build a fake SimpleGit exposing only the methods getRepoMetadata calls.
 * Each can be overridden to simulate remotes, branches, HEAD or failures.
 */
function fakeGit(over: {
  remotes?: { name: string; refs: { fetch?: string; push?: string } }[]
  branch?: string
  head?: string
  throwOn?: "getRemotes"
}): SimpleGit {
  return {
    getRemotes: async () => {
      if (over.throwOn === "getRemotes") throw new Error("not a git repo")
      return over.remotes ?? []
    },
    branch: async () => ({ current: over.branch ?? "" }),
    revparse: async () => over.head ?? "",
  } as unknown as SimpleGit
}

describe("getRepoMetadata", () => {
  it("parses an https GitHub remote into owner/name", async () => {
    const git = fakeGit({
      remotes: [{ name: "origin", refs: { fetch: "https://github.com/acme/widget.git" } }],
      branch: "main",
      head: "abc123\n",
    })
    const meta = await getRepoMetadata(git, "/tmp/widget")
    expect(meta.owner).toBe("acme")
    expect(meta.name).toBe("widget")
    expect(meta.defaultBranch).toBe("main")
    expect(meta.commit).toBe("abc123")
  })

  it("parses an SSH (git@) remote", async () => {
    const git = fakeGit({
      remotes: [{ name: "origin", refs: { push: "git@github.com:acme/widget.git" } }],
      branch: "develop",
    })
    const meta = await getRepoMetadata(git, "/tmp/x")
    expect(meta.owner).toBe("acme")
    expect(meta.name).toBe("widget")
    expect(meta.defaultBranch).toBe("develop")
  })

  it("strips a trailing .git and handles remotes without it", async () => {
    const git = fakeGit({
      remotes: [{ name: "origin", refs: { fetch: "https://gitlab.com/group/proj" } }],
    })
    const meta = await getRepoMetadata(git, "/tmp/x")
    expect(meta.owner).toBe("group")
    expect(meta.name).toBe("proj")
  })

  it("falls back to the folder name under 'local' when there is no remote", async () => {
    const git = fakeGit({ remotes: [], branch: "trunk" })
    const meta = await getRepoMetadata(git, "/home/me/cool-project")
    expect(meta.owner).toBe("local")
    expect(meta.name).toBe("cool-project")
    expect(meta.defaultBranch).toBe("trunk")
  })

  it("degrades to a usable identity when git is unavailable", async () => {
    const git = fakeGit({ throwOn: "getRemotes" })
    const meta = await getRepoMetadata(git, "/home/me/proj")
    expect(meta.owner).toBe("local")
    expect(meta.name).toBe("proj")
    expect(meta.defaultBranch).toBe("main")
    expect(meta.commit).toBeUndefined()
  })

  it("defaults the branch to main when current branch is empty", async () => {
    const git = fakeGit({
      remotes: [{ name: "origin", refs: { fetch: "https://github.com/a/b.git" } }],
      branch: "",
    })
    const meta = await getRepoMetadata(git, "/tmp/b")
    expect(meta.defaultBranch).toBe("main")
  })
})

/**
 * Exercises the REAL git adapter (not a fake) against a throwaway repo, so a
 * regression like "simple-git has no .blame()" — which silently made every age 0
 * — is caught. Creates a repo with a back-dated commit and asserts the computed
 * age matches.
 */
describe("buildScanContext git.blameAgeDays (real git)", () => {
  function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "rar-blame-"))
    const run = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    run("init", "-q")
    run("config", "user.email", "test@example.com")
    run("config", "user.name", "Test")
    run("config", "commit.gpgsign", "false")
    return dir
  }

  function commitFileAt(dir: string, name: string, body: string, isoDate: string) {
    writeFileSync(join(dir, name), body)
    execFileSync("git", ["add", name], { cwd: dir, stdio: "ignore" })
    execFileSync("git", ["commit", "-q", "-m", `add ${name}`], {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: isoDate,
        GIT_COMMITTER_DATE: isoDate,
      },
    })
  }

  it("returns the real committed-line age in days", async () => {
    const dir = makeRepo()
    try {
      // Commit a file dated 400 days ago.
      const days = 400
      const when = new Date(Date.now() - days * 86400_000).toISOString()
      commitFileAt(dir, "a.txt", "hello\nworld\n", when)

      const ctx = await buildScanContext(dir)
      const age = await ctx.git.blameAgeDays("a.txt", 1)

      // Allow a couple days of slack for date rounding / test-clock drift.
      expect(age).toBeGreaterThanOrEqual(days - 2)
      expect(age).toBeLessThanOrEqual(days + 2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns 0 for a line that isn't committed / file missing", async () => {
    const dir = makeRepo()
    try {
      commitFileAt(dir, "a.txt", "one\n", new Date().toISOString())
      const ctx = await buildScanContext(dir)
      // Line beyond the file and a non-existent file both degrade to 0, not throw.
      expect(await ctx.git.blameAgeDays("a.txt", 999)).toBe(0)
      expect(await ctx.git.blameAgeDays("nope.txt", 1)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * Exercises the REAL git history adapter: commit a file, then delete it in a
 * later commit, and assert `historyAdditions` still surfaces the line introduced
 * by the first commit (the basis for finding secrets removed from the tree).
 */
describe("buildScanContext git.historyAdditions (real git)", () => {
  function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "rar-hist-"))
    const run = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        stdio: "ignore",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      })
    run("init", "-q")
    run("config", "user.email", "test@example.com")
    run("config", "user.name", "Test")
    run("config", "commit.gpgsign", "false")
    return dir
  }

  const commit = (dir: string, msg: string) =>
    execFileSync("git", ["commit", "-q", "-m", msg], { cwd: dir, stdio: "ignore" })
  const add = (dir: string, name: string) =>
    execFileSync("git", ["add", "-A", name], { cwd: dir, stdio: "ignore" })

  it("surfaces a line introduced by a past commit even after the file is deleted", async () => {
    const dir = makeRepo()
    try {
      const secret = 'const k = "AKIAIOSFODNN7EXAMPLE"'
      writeFileSync(join(dir, "seed.ts"), `${secret}\n`)
      add(dir, "seed.ts")
      commit(dir, "add seed")

      // Delete the file in a later commit — gone from the working tree.
      unlinkSync(join(dir, "seed.ts"))
      add(dir, "seed.ts")
      commit(dir, "remove seed")

      const ctx = await buildScanContext(dir)
      const additions = ctx.git.historyAdditions
        ? await ctx.git.historyAdditions({ maxCommits: 50 })
        : []

      const hit = additions.find((a) => a.text.includes("AKIAIOSFODNN7EXAMPLE"))
      expect(hit).toBeDefined()
      expect(hit!.file).toBe("seed.ts")
      expect(hit!.commit).toMatch(/^[0-9a-f]{7,}$/)
      expect(hit!.date).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns [] for a non-git directory (degrades, never throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rar-nogit-"))
    try {
      const ctx = await buildScanContext(dir)
      const additions = ctx.git.historyAdditions
        ? await ctx.git.historyAdditions()
        : []
      expect(additions).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
