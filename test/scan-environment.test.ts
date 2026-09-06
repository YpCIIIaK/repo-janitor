import { describe, expect, it } from "vitest"
import { scanEnvironment } from "@/lib/scan-environment"

describe("scan process isolation", () => {
  it("keeps the executable path but drops server credentials and executable overrides", () => {
    const env = scanEnvironment({ PATH: "/bin", OPENROUTER_API_KEY: "secret", GITHUB_TOKEN: "token", SUPABASE_SERVICE_ROLE_KEY: "db", NODE_OPTIONS: "--import=evil", GIT_CONFIG_COUNT: "99", HOME: "/operator" })
    expect(env.PATH).toBe("/bin")
    for (const name of ["OPENROUTER_API_KEY", "GITHUB_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "NODE_OPTIONS", "HOME"]) expect(env[name]).toBeUndefined()
    expect(env.GIT_CONFIG_VALUE_0).toBe("false")
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.GIT_CONFIG_COUNT).toBe("5")
    expect(env.GIT_CONFIG_KEY_4).toBe("core.symlinks")
    expect(env.GIT_CONFIG_VALUE_4).toBe("false")
  })
})
