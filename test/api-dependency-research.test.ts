import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  allowRate: vi.fn(() => true),
  isOwner: vi.fn(() => false),
  isPublicGitUrl: vi.fn(async () => ({ ok: true })),
  mkdtemp: vi.fn(async () => "C:/temp/repo-janitor-research-test"),
  readdir: vi.fn(async () => []),
  readFile: vi.fn(async () => ""),
  rm: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ size: 0 })),
  run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  dirSizeExceeds: vi.fn(async () => false),
  researchDependencyGraph: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  readdir: mocks.readdir,
  readFile: mocks.readFile,
  rm: mocks.rm,
  stat: mocks.stat,
}))

vi.mock("@/lib/url-guard", () => ({ isPublicGitUrl: mocks.isPublicGitUrl }))
vi.mock("@/lib/clone-runner", () => ({
  MAX_CLONE_BYTES: 500 * 1024 * 1024,
  SIZE_POLL_MS: 2_000,
  dirSizeExceeds: mocks.dirSizeExceeds,
  run: mocks.run,
}))
vi.mock("@/lib/scan-limits", () => ({
  clientIp: vi.fn(() => "203.0.113.10"),
  limitsFromEnv: vi.fn(() => ({ trustedProxyHops: 1 })),
  withScanSlot: vi.fn(async (_limits, fn: () => Promise<unknown>) => fn()),
}))
vi.mock("@/lib/watch-rate", () => ({ allowRate: mocks.allowRate }))
vi.mock("@/lib/owner", () => ({ isOwner: mocks.isOwner }))
vi.mock("@repo-anti-rot/core", () => {
  class DependencyResearchLimitError extends Error {
    constructor(kind: string) {
      super(`Dependency research ${kind} limit exceeded`)
      this.name = "DependencyResearchLimitError"
    }
  }
  return {
    DependencyResearchLimitError,
    researchDependencyGraph: mocks.researchDependencyGraph,
  }
})

import { DependencyResearchLimitError } from "@repo-anti-rot/core"
import { POST } from "@/app/api/dependency-research/route"

const endpoint = "http://localhost/api/dependency-research"
const validBody = {
  repoUrl: "https://github.com/example/repository",
  target: "package@1.2.3",
  commit: "a".repeat(40),
}

function request(body: unknown = validBody): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/dependency-research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.allowRate.mockReturnValue(true)
    mocks.isOwner.mockReturnValue(false)
    mocks.isPublicGitUrl.mockResolvedValue({ ok: true })
    mocks.mkdtemp.mockResolvedValue("C:/temp/repo-janitor-research-test")
    mocks.readdir.mockResolvedValue([])
    mocks.run.mockResolvedValue({ code: 0, stdout: "", stderr: "" })
    mocks.dirSizeExceeds.mockResolvedValue(false)
    mocks.researchDependencyGraph.mockResolvedValue(null)
  })

  it.each([
    ["invalid JSON", new Request(endpoint, { method: "POST", body: "{" })],
    ["invalid target", request({ ...validBody, target: "bad target" })],
    ["invalid SHA", request({ ...validBody, commit: "abc123" })],
  ])("does not charge the rate limit for %s", async (_label, input) => {
    const response = await POST(input)

    expect(response.status).toBe(400)
    expect(mocks.allowRate).not.toHaveBeenCalled()
    expect(mocks.mkdtemp).not.toHaveBeenCalled()
  })

  it("returns Retry-After when the rate limit is exhausted", async () => {
    mocks.allowRate.mockReturnValue(false)

    const response = await POST(request())

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("3600")
    expect(mocks.mkdtemp).not.toHaveBeenCalled()
  })

  it("names Yarn among supported formats in the unsupported response", async () => {
    const response = await POST(request())
    const body = await response.json() as { error: string }

    expect(response.status).toBe(422)
    expect(body.error).toMatch(/Yarn Classic\/Berry/)
    expect(mocks.rm).toHaveBeenCalledWith("C:/temp/repo-janitor-research-test", {
      recursive: true,
      force: true,
    })
  })

  it("maps an internal graph budget error to 413 and cleans the checkout", async () => {
    mocks.researchDependencyGraph.mockRejectedValue(new DependencyResearchLimitError("nodes"))

    const response = await POST(request())

    expect(response.status).toBe(413)
    expect(mocks.rm).toHaveBeenCalledWith("C:/temp/repo-janitor-research-test", {
      recursive: true,
      force: true,
    })
  })

  it("marks successful reports private and non-cacheable and cleans the checkout", async () => {
    mocks.researchDependencyGraph.mockResolvedValue({
      manager: "npm",
      lockfile: "package-lock.json",
      nodes: [],
      edges: [],
      matches: [],
      paths: [],
      warnings: [],
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.rm).toHaveBeenCalledWith("C:/temp/repo-janitor-research-test", {
      recursive: true,
      force: true,
    })
  })
})
