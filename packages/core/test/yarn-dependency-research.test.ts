import { describe, expect, it } from "vitest"
import { parseYarnDependencyResearch } from "../src/yarn-dependency-research"

describe("parseYarnDependencyResearch", () => {
  it("parses Yarn Classic and separates production and development versions", () => {
    const lock = [
      "# yarn lockfile v1", "",
      "shared@^2.0.0:", "  version \"2.1.0\"", "",
      "shared@^1.0.0:", "  version \"1.2.0\"", "",
      "app@^1.0.0:", "  version \"1.0.0\"", "  dependencies:", "    shared \"^2.0.0\"", "",
      "tool@^1.0.0:", "  version \"1.0.0\"", "  dependencies:", "    shared \"^1.0.0\"",
    ].join("\n")
    const manifests = new Map([[".", JSON.stringify({ name: "root", dependencies: { app: "^1.0.0" }, devDependencies: { tool: "^1.0.0" } })]])
    const result = parseYarnDependencyResearch(lock, manifests, { target: "shared" })
    expect(result?.nodes.filter((node) => node.name === "shared").map((node) => [node.version, node.runtime])).toEqual([
      ["2.1.0", "production"], ["1.2.0", "development"],
    ])
    expect(result?.paths.map((path) => path.runtime).sort()).toEqual(["development", "production"])
  })

  it("parses Yarn Berry descriptors, aliases and exact peer locators", () => {
    const lock = [
      "__metadata:", "  version: 8", "",
      "\"alias@npm:real-package@^2.0.0\":", "  version: 2.2.0", "  resolution: \"real-package@npm:2.2.0\"", "  dependencies:", "    leaf: \"npm:^3.0.0\"", "",
      "\"leaf@npm:^3.0.0\":", "  version: 3.1.0", "  resolution: \"leaf@npm:3.1.0\"",
    ].join("\n")
    const result = parseYarnDependencyResearch(lock, { ".": JSON.stringify({ dependencies: { alias: "npm:real-package@^2.0.0" } }) }, { target: "leaf@3.1.0" })
    expect(result?.nodes.some((node) => node.name === "real-package" && node.version === "2.2.0")).toBe(true)
    expect(result?.nodes.some((node) => node.name === "alias")).toBe(false)
    expect(result?.nodes.find((node) => node.name === "leaf")?.runtime).toBe("production")
    expect(result?.paths).toHaveLength(1)
    expect(result?.warnings).toEqual([])
  })

  it("connects Berry workspace protocols between importers", () => {
    const result = parseYarnDependencyResearch([
      "__metadata:", "  version: 8", "",
      "\"leaf@npm:^1.0.0\":", "  version: 1.1.0", "  resolution: \"leaf@npm:1.1.0\"",
    ].join("\n"), new Map([
      [".", JSON.stringify({ name: "root", dependencies: { "@acme/api": "workspace:*" } })],
      ["packages/api", JSON.stringify({ name: "@acme/api", dependencies: { leaf: "^1.0.0" } })],
    ]), { target: "leaf" })
    expect(result?.edges.some((edge) => edge.kind === "workspace")).toBe(true)
    expect(result?.nodes.find((node) => node.name === "leaf")?.runtime).toBe("production")
  })

  it("marks Berry dependency metadata as optional and explains merged peer contexts", () => {
    const result = parseYarnDependencyResearch([
      "__metadata:", "  version: 8", "",
      "\"host@npm:^1.0.0\":", "  version: 1.0.0", "  resolution: \"host@npm:1.0.0\"",
      "  dependencies:", "    leaf: \"npm:^2.0.0\"", "  dependenciesMeta:", "    leaf:", "      optional: true",
      "  peerDependencies:", "    react: \"^18\"", "",
      "\"leaf@npm:^2.0.0\":", "  version: 2.1.0", "  resolution: \"leaf@npm:2.1.0\"",
    ].join("\n"), { ".": JSON.stringify({ dependencies: { host: "^1.0.0" } }) }, { target: "leaf" })
    expect(result?.edges.find((edge) => edge.name === "leaf")?.kind).toBe("optional")
    expect(result?.warnings.some((warning) => warning.includes("virtual peer instances"))).toBe(true)
  })

  it("fails closed when one descriptor maps to multiple entries", () => {
    const lock = [
      "\"widget@^1.0.0\":", "  version: 1.1.0", "",
      "\"widget@npm:^1.0.0\":", "  version: 1.2.0",
    ].join("\n")
    const result = parseYarnDependencyResearch(lock, { ".": JSON.stringify({ dependencies: { widget: "^1.0.0" } }) }, { target: "widget" })
    expect(result?.paths).toEqual([])
    expect(result?.warnings.some((warning) => warning.includes("Ambiguous Yarn resolution"))).toBe(true)
  })

  it("returns null for malformed lock data and warns on an invalid manifest", () => {
    expect(parseYarnDependencyResearch("not a yarn lock", new Map())).toBeNull()
    const result = parseYarnDependencyResearch("# yarn lockfile v1\n\nx@^1:\n  version \"1.0.0\"", { ".": "{" })
    expect(result?.warnings.some((warning) => warning.includes("manifest"))).toBe(true)
    expect(result?.nodes.find((node) => node.kind === "project")?.runtime).toBe("production")
  })
})
