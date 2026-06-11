import { describe, it, expect } from "vitest"
import { envLifecycleScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("envLifecycleScanner", () => {
  it("warns about a required var used in code but missing from .env.example", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "KNOWN=\n",
        "a.ts": "const a = process.env.SECRET_TOKEN\nconst b = process.env.KNOWN\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    const missing = issues.find((i) => i.id === "env-missing-SECRET_TOKEN")
    expect(missing).toBeDefined()
    expect(missing?.severity).toBe("warning")
    // KNOWN is documented → no finding for it
    expect(issues.some((i) => i.id === "env-missing-KNOWN")).toBe(false)
  })

  it("does not flag platform/CI env vars as undocumented (with .env.example)", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "APP_KEY=\n",
        "a.ts":
          "const r = process.env.GITHUB_REPOSITORY\n" +
          "const c = process.env.CI\n" +
          "const n = process.env.NODE_ENV\n" +
          "const i = process.env.INPUT_FAIL_ON\n" +
          "const k = process.env.APP_KEY\n" +
          "const s = process.env.SECRET_TOKEN\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    const missing = issues.filter((i) => i.id.startsWith("env-missing-")).map((i) => i.id)
    // Only the genuine project var is flagged; platform vars are excluded.
    expect(missing).toEqual(["env-missing-SECRET_TOKEN"])
  })

  it("excludes platform/CI vars from the no-example summary count", async () => {
    const ctx = makeContext({
      files: {
        "a.ts":
          "const r = process.env.GITHUB_EVENT_NAME\n" +
          "const x = process.env.NO_COLOR\n" +
          "const real = process.env.MY_API_URL\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    const note = issues.find((i) => i.id === "env-no-example")
    expect(note).toBeDefined()
    expect(note?.title).toContain("1 env var")
    expect(note?.detail).toContain("MY_API_URL")
    expect(note?.detail).not.toContain("GITHUB_EVENT_NAME")
    expect(note?.detail).not.toContain("NO_COLOR")
  })

  it("downgrades an undocumented var WITH an in-code fallback to info", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "\n",
        "a.ts": 'const a = process.env.OPTIONAL ?? "default"\n',
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    const opt = issues.find((i) => i.id === "env-missing-OPTIONAL")
    expect(opt?.severity).toBe("info")
  })

  it("flags a var declared in .env.example but never used (dead env var)", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "USED=\nUNUSED=\n",
        "a.ts": "const a = process.env.USED\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    expect(issues.find((i) => i.id === "env-dead-UNUSED")).toBeDefined()
    expect(issues.find((i) => i.id === "env-dead-USED")).toBeUndefined()
  })

  it("suppresses the dead-var check when env is accessed dynamically", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "UNUSED=\n",
        "a.ts": "const key = 'X'\nconst v = process.env[key]\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    expect(issues.some((i) => i.id.startsWith("env-dead-"))).toBe(false)
  })

  it("understands destructuring access", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "\n",
        "a.ts": "const { DB_URL } = process.env\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    expect(issues.find((i) => i.id === "env-missing-DB_URL")).toBeDefined()
  })

  it("ignores process.env mentions inside strings/comments (AST-based)", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "\n",
        "a.ts": '// process.env.FAKE_ONE\nconst s = "process.env.FAKE_TWO"\n',
      },
    })
    expect(await envLifecycleScanner.run(ctx)).toHaveLength(0)
  })

  it("emits a single info nudge when there is no .env.example", async () => {
    const ctx = makeContext({
      files: { "a.ts": "const a = process.env.FOO\nconst b = process.env.BAR\n" },
    })
    const issues = await envLifecycleScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe("env-no-example")
    expect(issues[0].severity).toBe("info")
    expect(issues[0].detail).toContain("FOO")
    expect(issues[0].detail).toContain("BAR")
  })

  it("extracts Python os.getenv usage", async () => {
    const ctx = makeContext({
      files: {
        ".env.example": "\n",
        "main.py": "import os\nval = os.getenv('PY_VAR')\n",
      },
    })
    const issues = await envLifecycleScanner.run(ctx)
    expect(issues.find((i) => i.id === "env-missing-PY_VAR")).toBeDefined()
  })
})
