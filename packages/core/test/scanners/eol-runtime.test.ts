import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { scanFileForEol, eolRuntimeScanner } from "../../src/scanners/eol-runtime"
import type { ScanContext } from "../../src/scanner"

/**
 * The clock is the input this scanner actually reads, so every test pins it.
 * Left to the real date these cases would change meaning as time passed — which
 * is the very thing the scanner is about, and a spectacularly annoying way for a
 * test suite to start failing.
 */
const NOW = new Date("2026-07-30T00:00:00Z")

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const kinds = (file: string, content: string) =>
  scanFileForEol(file, content).map((f) => `${f.kind}:${f.version}${f.pinned ? "" : "(floor)"}`)

describe("scanFileForEol", () => {
  describe(".nvmrc", () => {
    it("reads a pinned major", () => {
      expect(kinds(".nvmrc", "14\n")).toEqual(["node:14"])
    })

    it("reads a v-prefixed exact version", () => {
      expect(kinds(".nvmrc", "v14.21.3\n")).toEqual(["node:v14.21.3"])
    })

    it("says nothing about an lts alias", () => {
      // `lts/hydrogen` follows the release line on its own — it is not a pin to
      // a dead major, and today's alias is not knowable from a bundled table.
      expect(kinds(".nvmrc", "lts/hydrogen\n")).toEqual([])
    })

    it("skips a leading comment", () => {
      const found = scanFileForEol(".nvmrc", "# the version CI uses\n14\n")
      expect(found).toHaveLength(1)
      expect(found[0].line).toBe(2)
    })
  })

  describe("package.json engines", () => {
    it("treats a >= range as a floor, not a pin", () => {
      // `>=14` is everywhere and usually means "we don't care, but not older".
      // Reporting it as though the project runs on 14 would slander half of npm.
      expect(kinds("package.json", '{"engines":{"node":">=14"}}')).toEqual(["node:>=14(floor)"])
    })

    it("treats a caret range as a pin", () => {
      // ^16 admits 16.x only, so the dead major IS what runs.
      expect(kinds("package.json", '{"engines":{"node":"^16.0.0"}}')).toEqual(["node:^16.0.0"])
    })

    it("points at the line the engines field is on", () => {
      const found = scanFileForEol(
        "package.json",
        '{\n  "name": "x",\n  "engines": {\n    "node": "14"\n  }\n}',
      )
      expect(found[0].line).toBe(4)
    })

    it("survives malformed json", () => {
      expect(scanFileForEol("package.json", "{ not json")).toEqual([])
    })

    it("says nothing when there is no engines field", () => {
      expect(scanFileForEol("package.json", '{"name":"x","dependencies":{}}')).toEqual([])
    })
  })

  describe("Dockerfile", () => {
    it("reads a node base image with a suffixed tag", () => {
      expect(kinds("Dockerfile", "FROM node:14-alpine\nRUN npm ci\n")).toEqual(["node:14-alpine"])
    })

    it("reads a python base image", () => {
      expect(kinds("Dockerfile", "FROM python:3.7-slim\n")).toEqual(["python:3.7-slim"])
    })

    it("separates the raw tag from the release it resolves to", () => {
      // The title reads off `release`, so it says "Python 3.7" rather than
      // "Python 3.7-slim" — the image flavour is not part of the version.
      const [f] = scanFileForEol("Dockerfile", "FROM python:3.7-slim\n")
      expect(f.version).toBe("3.7-slim")
      expect(f.release).toBe("3.7")
      expect(f.evidence).toBe("FROM python:3.7-slim")
    })

    it("ignores a digest-pinned image", () => {
      // A digest carries no readable version. Guessing from the tag beside it
      // would be reading a label that no longer determines what is pulled.
      expect(kinds("Dockerfile", "FROM node:14@sha256:abc123\n")).toEqual([])
    })

    it("ignores a build-arg image", () => {
      expect(kinds("Dockerfile", "ARG IMG\nFROM $IMG\n")).toEqual([])
    })

    it("ignores a commented-out FROM", () => {
      // The live FROM is still read — this function reports every version it can
      // resolve, and it is the scanner that decides which are past their date.
      // The point of the case is that the dead one behind the `#` is not there.
      expect(kinds("Dockerfile", "# FROM node:14\nFROM node:24\n")).toEqual(["node:24"])
    })

    it("ignores images that are not a runtime we track", () => {
      expect(kinds("Dockerfile", "FROM nginx:1.18\nFROM redis:5\n")).toEqual([])
    })

    it("reads a registry-qualified image without tripping on the host port", () => {
      expect(kinds("Dockerfile", "FROM registry.example.com:5000/node:14\n")).toEqual(["node:14"])
    })
  })

  describe("Python packaging", () => {
    it("reads requires-python as a floor", () => {
      expect(kinds("pyproject.toml", 'requires-python = ">=3.7"\n')).toEqual(["python:>=3.7(floor)"])
    })

    it("reads python_requires from setup.py", () => {
      expect(kinds("setup.py", 'setup(name="x", python_requires=">=3.6")\n')).toEqual([
        "python:>=3.6(floor)",
      ])
    })
  })

  describe("workflows", () => {
    it("flags a retired runner image", () => {
      expect(
        kinds(".github/workflows/ci.yml", "jobs:\n  a:\n    runs-on: ubuntu-18.04\n"),
      ).toEqual(["runner:ubuntu-18.04"])
    })

    it("says nothing about a floating label", () => {
      // ubuntu-latest is the recommendation and moves by itself.
      expect(kinds(".github/workflows/ci.yml", "    runs-on: ubuntu-latest\n")).toEqual([])
    })

    it("reads the version setup-node installs", () => {
      expect(
        kinds(".github/workflows/ci.yml", "      - uses: actions/setup-node@v4\n        with:\n          node-version: 16\n"),
      ).toEqual(["node:16"])
    })

    it("reads a quoted python-version", () => {
      expect(kinds(".github/workflows/ci.yml", '          python-version: "3.8"\n')).toEqual([
        "python:3.8",
      ])
    })

    it("does not flag a version matrix", () => {
      // Found on express, which tests on `[16, 17]` deliberately. A matrix
      // holding an old version is a library keeping a compatibility promise,
      // not a project stuck on a dead runtime — the opposite of a finding.
      expect(
        kinds(".github/workflows/ci.yml", "        node-version: [16, 17]\n"),
      ).toEqual([])
    })

    it("does not flag a matrix reference", () => {
      expect(
        kinds(".github/workflows/ci.yml", "          node-version: ${{ matrix.node }}\n"),
      ).toEqual([])
    })

    it("does not read a yaml file outside .github/workflows", () => {
      // A docker-compose.yml with a `runs-on:` key in it is not a workflow.
      expect(kinds("deploy/ci.yml", "runs-on: ubuntu-18.04\n")).toEqual([])
    })
  })

  it("says nothing about a version the table has never heard of", () => {
    // The safety property the whole design rests on: when this table falls
    // behind, the scanner under-reports rather than inventing findings.
    expect(kinds(".nvmrc", "99\n")).toEqual([])
    expect(kinds("Dockerfile", "FROM python:4.2\n")).toEqual([])
  })
})

describe("eolRuntimeScanner", () => {
  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: {
        blameAgeDays: async () => 400,
        listBranches: async () => [],
      },
    }) as unknown as ScanContext

  it("reports nothing for a repository on current runtimes", async () => {
    const issues = await eolRuntimeScanner.run(
      ctx({ ".nvmrc": "24\n", "Dockerfile": "FROM python:3.13-slim\n" }),
    )
    expect(issues).toEqual([])
  })

  it("reports nothing when there is no manifest to read", async () => {
    expect(await eolRuntimeScanner.run(ctx({ "src/index.ts": "export {}" }))).toEqual([])
  })

  it("scores a pin to a dead runtime as a warning", async () => {
    const issues = await eolRuntimeScanner.run(ctx({ ".nvmrc": "14\n" }))
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
    expect(issues[0].category).toBe("dependency")
    expect(issues[0].location).toBe(".nvmrc:1")
    expect(issues[0].ageDays).toBe(400)
    expect(issues[0].detail).toContain("2023-04-30")
  })

  it("scores a permissive floor as info", async () => {
    const issues = await eolRuntimeScanner.run(
      ctx({ "package.json": '{"engines":{"node":">=14"}}' }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
    expect(issues[0].title).toContain("floor")
  })

  it("scores a retired runner as critical", async () => {
    // Different in kind from an unpatched runtime: the workflow does not run at
    // all, so this is broken now rather than risky later.
    const issues = await eolRuntimeScanner.run(
      ctx({ ".github/workflows/ci.yml": "jobs:\n  a:\n    runs-on: ubuntu-20.04\n" }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("critical")
  })

  it("warns ahead of an EOL date that has not arrived yet", async () => {
    // Python 3.10 dies 2026-10-31, 93 days after the pinned clock — just
    // outside the window, so still silent.
    expect(await eolRuntimeScanner.run(ctx({ "Dockerfile": "FROM python:3.10\n" }))).toEqual([])
    // Node 20 dies 2026-04-30, already past.
    const past = await eolRuntimeScanner.run(ctx({ ".nvmrc": "20\n" }))
    expect(past).toHaveLength(1)
    expect(past[0].severity).toBe("warning")
  })

  it("stays silent on a runtime that is comfortably supported", async () => {
    expect(await eolRuntimeScanner.run(ctx({ ".nvmrc": "22\n" }))).toEqual([])
  })

  it("survives a repository where blame is unavailable", async () => {
    const broken = ctx({ ".nvmrc": "14\n" })
    broken.git.blameAgeDays = async () => {
      throw new Error("not a git repository")
    }
    const issues = await eolRuntimeScanner.run(broken)
    expect(issues).toHaveLength(1)
    expect(issues[0].ageDays).toBe(0)
  })
})
