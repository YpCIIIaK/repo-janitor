import { describe, it, expect } from "vitest"
import { extToLanguage, detectTools, detectChecklist } from "../src/profile"
import { runScan } from "../src/engine"
import { erlangSecurityScanner } from "../src/scanners/erlang-security"
import { projectHygieneScanner } from "../src/scanners/project-hygiene"
import { makeContext } from "./helpers"

describe("extToLanguage", () => {
  it("counts Erlang modules, headers and escripts as Erlang", () => {
    for (const file of ["src/server.erl", "include/messages.hrl", "scripts/release.escript", "SRC\\SERVER.ERL"]) expect(extToLanguage(file)).toBe("Erlang")
    expect(detectTools(["apps/worker/rebar.config", "rebar.lock"])).toContain("Rebar3")
  })

  it("profiles actual Erlang source and records the new scanner's completion", async () => {
    const report = await runScan(makeContext({ files: {"src/server.erl":"-module(server).\nf() -> ok.\n", "include/messages.hrl":"-define(READY, ready).\n"} }),[erlangSecurityScanner])
    expect(report.profile?.languages).toContainEqual({language:'Erlang',files:2,loc:3})
    expect(report.metrics?.linesOfCode).toBe(3)
    expect(report.diagnostics?.completedScanners).toContain('erlang-security')
  })

  it("recognizes standalone Common Test and EUnit modules as real tests", async () => {
    for (const name of ['server_SUITE.erl','server_tests.erl','server_test.erl']) {
      expect(detectChecklist([name]).tests).toBe(true)
      const issues=await projectHygieneScanner.run(makeContext({files:{[name]:'-module(server_tests).'}}))
      expect(issues.some(x=>x.id==='hygiene-no-tests')).toBe(false)
    }
  })
  it("maps common source extensions to display languages", () => {
    expect(extToLanguage("src/app.ts")).toBe("TypeScript")
    expect(extToLanguage("src/App.tsx")).toBe("TypeScript")
    expect(extToLanguage("util.js")).toBe("JavaScript")
    expect(extToLanguage("main.py")).toBe("Python")
    expect(extToLanguage("server.go")).toBe("Go")
    expect(extToLanguage("lib.rs")).toBe("Rust")
    expect(extToLanguage("Component.vue")).toBe("Vue")
  })

  it("is case-insensitive and slash-agnostic", () => {
    expect(extToLanguage("SRC\\Main.PY")).toBe("Python")
  })

  it("returns null for non-source files", () => {
    expect(extToLanguage("README.md")).toBeNull()
    expect(extToLanguage("package.json")).toBeNull()
    expect(extToLanguage("Dockerfile")).toBeNull()
    expect(extToLanguage("noextension")).toBeNull()
  })
})

describe("detectTools", () => {
  it("detects ecosystems from characteristic files in stable order", () => {
    const tools = detectTools([
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "next.config.ts",
      "Dockerfile",
      ".github/workflows/ci.yml",
      "src/app.ts",
    ])
    expect(tools).toEqual(["Node.js", "pnpm", "TypeScript", "Next.js", "Docker", "GitHub Actions"])
  })

  it("detects polyglot manifests", () => {
    const tools = detectTools(["go.mod", "requirements.txt", "Cargo.toml", "Gemfile", "composer.json"])
    expect(tools).toEqual(["Go modules", "pip", "Cargo", "Bundler", "Composer"])
  })

  it("matches nested manifests and is case-insensitive", () => {
    expect(detectTools(["services/api/package.json"])).toContain("Node.js")
    expect(detectTools(["DOCKERFILE"])).toContain("Docker")
    expect(detectTools(["ops/docker-compose.yaml"])).toContain("Docker Compose")
  })

  it("returns nothing when no manifest is present", () => {
    expect(detectTools(["src/a.ts", "README.md"])).toEqual([])
  })
})
