import { describe, it, expect } from "vitest"
import { dockerfileScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("dockerfileScanner", () => {
  it("warns on an untagged base image", async () => {
    const ctx = makeContext({ files: { Dockerfile: "FROM node\nUSER app\n" } })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.startsWith("docker-untagged-"))).toBe(true)
  })

  it("warns on a :latest base image", async () => {
    const ctx = makeContext({ files: { Dockerfile: "FROM node:latest\nUSER app\n" } })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.startsWith("docker-latest-"))).toBe(true)
  })

  it("does not warn on a pinned version or a digest", async () => {
    const ctx = makeContext({
      files: {
        Dockerfile: "FROM node:20.11.0\nUSER app\n",
        "a.dockerfile": "FROM node@sha256:abc123\nUSER app\n",
      },
    })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.includes("untagged") || i.id.includes("latest"))).toBe(false)
  })

  it("infos when no non-root USER is set", async () => {
    const ctx = makeContext({ files: { Dockerfile: "FROM node:20\nRUN echo hi\n" } })
    const issues = await dockerfileScanner.run(ctx)
    const root = issues.find((i) => i.id.startsWith("docker-root-"))
    expect(root?.severity).toBe("info")
  })

  it("does not flag root when a non-root USER is present", async () => {
    const ctx = makeContext({ files: { Dockerfile: "FROM node:20\nUSER node\n" } })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.startsWith("docker-root-"))).toBe(false)
  })

  it("infos on ADD of a remote URL", async () => {
    const ctx = makeContext({
      files: { Dockerfile: "FROM node:20\nUSER node\nADD https://example.com/x.tar /x\n" },
    })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.startsWith("docker-add-url-"))).toBe(true)
  })

  it("exempts multi-stage aliases from the unpinned check", async () => {
    const ctx = makeContext({
      files: {
        Dockerfile: "FROM node:20 AS build\nUSER node\nFROM build\nUSER node\n",
      },
    })
    const issues = await dockerfileScanner.run(ctx)
    expect(issues.some((i) => i.id.includes("untagged"))).toBe(false)
  })

  it("ignores non-Dockerfile files", async () => {
    const ctx = makeContext({ files: { "notes.txt": "FROM node\n" } })
    expect(await dockerfileScanner.run(ctx)).toHaveLength(0)
  })
})
