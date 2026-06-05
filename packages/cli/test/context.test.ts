import { describe, it, expect } from "vitest"
import type { SimpleGit } from "simple-git"
import { getRepoMetadata } from "../src/context"

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
