import { describe, expect, it } from "vitest"
import { researchDependencyGraph } from "../src/dependency-research"
import { makeContext } from "./helpers"

const run = (files: Record<string, string>, target?: string) =>
  researchDependencyGraph(makeContext({ files }), new Set(Object.keys(files)), { target })

describe("researchDependencyGraph", () => {
  it("reconstructs npm v3 paths through hoisting and separates prod from dev", async () => {
    const result = await run({ "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "": { name: "root", dependencies: { app: "1.0.0" }, devDependencies: { tool: "1.0.0" } },
      "node_modules/app": { version: "1.0.0", dependencies: { shared: "2.0.0" } },
      "node_modules/shared": { version: "2.0.0" },
      "node_modules/tool": { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      "node_modules/tool/node_modules/shared": { version: "1.0.0" },
    } }) }, "shared")
    expect(result?.manager).toBe("npm")
    expect(result?.nodes.filter((node) => node.name === "shared").map((node) => [node.version, node.runtime])).toEqual([
      ["2.0.0", "production"], ["1.0.0", "development"],
    ])
    expect(result?.paths.map((path) => [path.runtime, path.nodeIds.at(-1)])).toEqual([
      ["production", "npm:node_modules/shared"], ["development", "npm:node_modules/tool/node_modules/shared"],
    ])
  })

  it("supports package-lock v2 workspace importers", async () => {
    const result = await run({ "package-lock.json": JSON.stringify({ lockfileVersion: 2, packages: {
      "": { name: "root", dependencies: { api: "workspace:*" } },
      "packages/api": { name: "api", dependencies: { fastify: "4.0.0" } },
      "node_modules/api": { resolved: "packages/api", link: true },
      "node_modules/fastify": { version: "4.0.0" },
    } }) })
    expect(result?.nodes.find((node) => node.name === "fastify")?.runtime).toBe("production")
    expect(result?.nodes.some((node) => node.kind === "project" && node.name === "api")).toBe(true)
    expect(result?.edges.some((edge) => edge.kind === "workspace" && edge.to === "npm:packages/api")).toBe(true)
  })

  it("walks pnpm v9 aliases, peer variants and workspace links", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "root" }),
      "packages/api/package.json": JSON.stringify({ name: "@acme/api" }),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'", "importers:", "  .:", "    dependencies:",
        "      api:", "        version: link:packages/api", "      safe:", "        version: npm:real-safe@2.0.0(peer@1.0.0)",
        "  packages/api:", "    devDependencies:", "      tool:", "        version: 1.0.0",
        "snapshots:", "  real-safe@2.0.0(peer@1.0.0):", "    dependencies:", "      leaf: 3.0.0",
        "  real-safe@2.0.0(peer@2.0.0): {}", "  leaf@3.0.0: {}", "  tool@1.0.0: {}",
      ].join("\n"),
    }
    const result = await run(files, "real-safe@2.0.0")
    expect(result?.matches).toHaveLength(2)
    expect(result?.nodes.find((node) => node.location.includes("peer@1"))?.runtime).toBe("production")
    expect(result?.nodes.find((node) => node.location.includes("peer@2"))?.runtime).toBe("unknown")
    expect(result?.nodes.find((node) => node.name === "tool")?.runtime).toBe("development")
    expect(result?.edges.some((edge) => edge.kind === "workspace")).toBe(true)
    expect(result?.paths).toHaveLength(1)
  })

  it("returns null for unsupported or incomplete lockfiles", async () => {
    expect(await run({ "yarn.lock": "x@1:\n  version 1.0.0" })).toBeNull()
    expect(await run({ "package-lock.json": JSON.stringify({ lockfileVersion: 1 }) })).toBeNull()
  })

  it("resolves relative links between pnpm workspace importers", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "root" }),
      "packages/api/package.json": JSON.stringify({ name: "api" }),
      "packages/shared/package.json": JSON.stringify({ name: "shared" }),
      "pnpm-lock.yaml": [
        "importers:", "  .:", "    dependencies:", "      api:", "        version: link:packages/api",
        "  packages/api:", "    dependencies:", "      shared:", "        version: link:../shared",
        "  packages/shared:", "    dependencies:", "      leaf:", "        version: 1.0.0",
        "snapshots:", "  leaf@1.0.0: {}",
      ].join("\n"),
    }
    const result = await run(files, "leaf")
    expect(result?.paths).toHaveLength(3)
    expect(result?.paths.some((path) => path.nodeIds.includes("pnpm:importer:packages/shared"))).toBe(true)
    expect(result?.warnings).toEqual([])
  })

  it("refuses to guess between ambiguous pnpm peer variants", async () => {
    const result = await run({
      "package.json": "{}",
      "pnpm-lock.yaml": [
        "importers:", "  .:", "    dependencies:", "      widget:", "        version: 1.0.0",
        "snapshots:", "  widget@1.0.0(peer@1.0.0): {}", "  widget@1.0.0(peer@2.0.0): {}",
      ].join("\n"),
    }, "widget")
    expect(result?.paths).toEqual([])
    expect(result?.warnings.some((warning) => warning.includes("Could not resolve widget"))).toBe(true)
  })

  it("does not follow nested devDependencies as installed transitive paths", async () => {
    const result = await run({ "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
      "": { devDependencies: { tool: "1.0.0" } },
      "node_modules/tool": { version: "1.0.0", devDependencies: { hidden: "1.0.0" } },
      "node_modules/hidden": { version: "1.0.0" },
    } }) }, "hidden")
    expect(result?.paths).toEqual([])
  })

  it("bounds path depth on hostile lock graphs", async () => {
    const snapshots: string[] = []
    for (let i = 0; i < 180; i++) {
      snapshots.push(`  p${i}@1.0.0:`)
      if (i < 179) snapshots.push("    dependencies:", `      p${i + 1}: 1.0.0`)
    }
    const result = await run({ "package.json": "{}", "pnpm-lock.yaml": [
      "importers:", "  .:", "    dependencies:", "      p0: 1.0.0", "snapshots:", ...snapshots,
    ].join("\n") }, "p179")
    expect(result?.warnings.some((warning) => warning.includes("safety limit"))).toBe(true)
  })
})
