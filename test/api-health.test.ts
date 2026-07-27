import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/health/route"

/**
 * Health-endpoint tests.
 *
 * The point of the route is to tell the truth about a host that cannot scan, so
 * that is what these assert: the failure paths, not the happy one. `clone-runner`
 * is mocked so no real `git` is involved and the result does not depend on
 * whatever is installed on the machine running the tests. `vi.mock` is hoisted
 * above the imports, so the route is imported statically — a top-level
 * `await import` would need target ES2017+ and this tsconfig targets ES6.
 */
const run = vi.fn()
vi.mock("@/lib/clone-runner", () => ({
  CLI_DIST: "/nonexistent/packages/cli/dist/index.js",
  run: (...args: unknown[]) => run(...args),
}))

type Body = {
  ok: boolean
  canScan: boolean
  checks: Record<"git" | "cli" | "tmp", { ok: boolean; detail: string }>
  hint?: string
}

beforeEach(() => {
  run.mockReset()
})

describe("GET /api/health", () => {
  it("reports canScan:false with a usable hint when git is missing", async () => {
    run.mockRejectedValue(new Error("spawn git ENOENT"))
    const res = await GET()
    const body = (await res.json()) as Body

    expect(res.status).toBe(200) // the app is up; the scanner is not
    expect(body.canScan).toBe(false)
    expect(body.checks.git.ok).toBe(false)
    expect(body.checks.git.detail).toContain("ENOENT")
    expect(body.hint).toContain("serverless")
  })

  it("reports a non-zero git exit as a failure rather than swallowing it", async () => {
    run.mockResolvedValue({ code: 127, stdout: "", stderr: "command not found" })
    const body = (await (await GET()).json()) as Body
    expect(body.checks.git.ok).toBe(false)
    expect(body.checks.git.detail).toContain("command not found")
  })

  it("flags a missing CLI build separately from a missing git", async () => {
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0\n", stderr: "" })
    const body = (await (await GET()).json()) as Body

    expect(body.checks.git.ok).toBe(true)
    expect(body.checks.git.detail).toBe("git version 2.43.0")
    // CLI_DIST is mocked to a path that does not exist.
    expect(body.checks.cli.ok).toBe(false)
    expect(body.checks.cli.detail).toContain("run the CLI build")
    expect(body.canScan).toBe(false)
  })

  it("finds the temp dir writable on a normal machine", async () => {
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const body = (await (await GET()).json()) as Body
    expect(body.checks.tmp.ok).toBe(true)
  })

  it("is never cached — a cached health check is worse than none", async () => {
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const res = await GET()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })
})
