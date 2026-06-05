import { describe, it, expect } from "vitest"
import { reportFileName } from "../src/naming"

describe("reportFileName", () => {
  it("maps each format to its extension", () => {
    expect(reportFileName("repo", "json")).toBe("repo.json")
    expect(reportFileName("repo", "md")).toBe("repo.md")
    expect(reportFileName("repo", "markdown")).toBe("repo.md") // alias
    expect(reportFileName("repo", "terminal")).toBe("repo.txt")
    expect(reportFileName("repo", "sarif")).toBe("repo.sarif")
  })

  it("falls back to terminal (.txt) for unknown formats", () => {
    expect(reportFileName("repo", "nonsense")).toBe("repo.txt")
  })

  it("sanitizes unsafe characters in the repo name", () => {
    expect(reportFileName("my repo/../etc", "json")).toBe("my_repo_.._etc.json")
    expect(reportFileName("a@b#c", "json")).toBe("a_b_c.json")
  })

  it("keeps already-safe characters intact", () => {
    expect(reportFileName("My-Repo_1.0", "json")).toBe("My-Repo_1.0.json")
  })
})
