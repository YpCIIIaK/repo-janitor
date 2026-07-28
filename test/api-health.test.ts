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
// Reached transitively through the share-store check; throws outside an RSC.
vi.mock("server-only", () => ({}))

const run = vi.fn()
vi.mock("@/lib/clone-runner", () => ({
  CLI_DIST: "/nonexistent/packages/cli/dist/index.js",
  run: (...args: unknown[]) => run(...args),
}))

type Body = {
  ok: boolean
  canScan: boolean
  durableShares: boolean
  checks: Record<"git" | "cli" | "tmp" | "shareStore", { ok: boolean; detail: string }>
  hint?: string
}

const savedEnv = { ...process.env }

beforeEach(() => {
  run.mockReset()
  process.env = { ...savedEnv }
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
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

  /**
   * Both share backends behave identically from outside, so a deploy that
   * silently fell back to the filesystem looks fine right up until a redeploy
   * wipes every posted link. The endpoint has to say which one is live.
   */
  it("warns when share links are stored somewhere ephemeral", async () => {
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const body = (await (await GET()).json()) as Body

    expect(body.durableShares).toBe(false)
    expect(body.checks.shareStore.detail).toContain("EPHEMERAL")
    expect(body.checks.shareStore.detail).toContain("SUPABASE_URL")
  })

  it("reports a durable share store once Supabase is configured", async () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const body = (await (await GET()).json()) as Body

    expect(body.durableShares).toBe(true)
    expect(body.checks.shareStore.detail).toContain("supabase")
    // The secret must not travel in a public health response.
    expect(JSON.stringify(body)).not.toContain("service-key")
  })

  it("keeps scan readiness independent of the share backend", async () => {
    // A host can be perfectly good at scanning while storing links somewhere
    // that forgets them; conflating the two would hide a real scan failure.
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const body = (await (await GET()).json()) as Body
    expect(body.durableShares).toBe(false)
    expect(body.checks.git.ok).toBe(true)
  })

  it("is never cached — a cached health check is worse than none", async () => {
    run.mockResolvedValue({ code: 0, stdout: "git version 2.43.0", stderr: "" })
    const res = await GET()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })
})
