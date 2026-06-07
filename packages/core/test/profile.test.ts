import { describe, it, expect } from "vitest"
import { extToLanguage, detectTools } from "../src/profile"

describe("extToLanguage", () => {
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
