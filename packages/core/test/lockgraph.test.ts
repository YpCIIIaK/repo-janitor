import { describe, it, expect } from "vitest"
import { computeNpmProdSet } from "../src/lockgraph"
import { makeContext } from "./helpers"

/**
 * The production-reachability graph. This exists because audit tooling lies:
 * `pnpm audit` in a workspace marks every advisory `dev: false` and reports
 * `devDependencies: 0`, so the flag cannot be used to tell shipping code from
 * build tooling.
 */
describe("computeNpmProdSet", () => {
  async function run(files: Record<string, string>) {
    const ctx = makeContext({ files })
    return computeNpmProdSet(ctx, new Set(Object.keys(files)))
  }

  it("returns null with no recognised lockfile", async () => {
    expect(await run({ "package.json": "{}" })).toBeNull()
  })

  it("returns null for yarn.lock, which records no dev/prod split", async () => {
    expect(await run({ "yarn.lock": 'lodash@^4:\n  version "4.17.21"\n' })).toBeNull()
  })

  it("reads the dev flag from package-lock.json", async () => {
    const prod = await run({
      "package-lock.json": JSON.stringify({
        packages: {
          "": { name: "root" },
          "node_modules/react": { version: "19.0.0" },
          "node_modules/eslint": { version: "9.0.0", dev: true },
          "node_modules/eslint/node_modules/brace-expansion": { version: "1.0.0", dev: true },
        },
      }),
    })
    expect(prod).toEqual(new Set(["react"]))
  })

  it("walks the pnpm graph from importer production deps", async () => {
    const prod = await run({
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      next:",
        "        specifier: ^16.0.0",
        "        version: 16.2.6",
        "    devDependencies:",
        "      eslint:",
        "        specifier: ^9.0.0",
        "        version: 9.0.0",
        "",
        "  packages/cli:",
        "    dependencies:",
        "      commander:",
        "        specifier: ^12.0.0",
        "        version: 12.1.0",
        "",
        "snapshots:",
        "",
        "  next@16.2.6:",
        "    dependencies:",
        "      sharp: 0.34.1",
        "    transitivePeerDependencies:",
        "      - babel-plugin-macros",
        "",
        "  sharp@0.34.1:",
        "    dependencies:",
        "      color: 4.2.3",
        "",
        "  color@4.2.3: {}",
        "",
        "  eslint@9.0.0:",
        "    dependencies:",
        "      brace-expansion: 1.0.0",
        "",
        "  brace-expansion@1.0.0: {}",
        "",
        "  commander@12.1.0: {}",
        "",
      ].join("\n"),
    })
    // Transitive prod deps of every importer, across the whole workspace.
    expect(prod).toEqual(new Set(["next", "sharp", "color", "commander"]))
    expect(prod!.has("eslint")).toBe(false)
    expect(prod!.has("brace-expansion")).toBe(false)
  })

  it("handles quoted scoped names and pnpm peer suffixes", async () => {
    const prod = await run({
      "pnpm-lock.yaml": [
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      '@radix-ui/react-dialog':",
        "        specifier: 1.1.15",
        "        version: 1.1.15(react@19.2.4)",
        "",
        "snapshots:",
        "",
        "  '@radix-ui/react-dialog@1.1.15(react@19.2.4)':",
        "    dependencies:",
        "      '@radix-ui/primitive': 1.1.3",
        "      react: 19.2.4",
        "",
        "  '@radix-ui/primitive@1.1.3': {}",
        "",
        "  react@19.2.4: {}",
        "",
      ].join("\n"),
    })
    expect(prod).toEqual(new Set(["@radix-ui/react-dialog", "@radix-ui/primitive", "react"]))
  })

  it("refuses to guess when a pnpm lock has no importers section", async () => {
    expect(
      await run({ "pnpm-lock.yaml": "packages:\n  /app@1.0.0:\n    resolution: {integrity: aaa}\n" }),
    ).toBeNull()
  })
})
