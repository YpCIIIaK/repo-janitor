import { describe, it, expect } from "vitest"
import {
  findFilenameConflicts,
  findPackageKeyConflicts,
  findStrictOff,
  configConflictScanner,
} from "../../src/scanners/config-conflict"
import type { ScanContext } from "../../src/scanner"

const kinds = (files: string[]) => findFilenameConflicts(files).map((c) => c.kind)

describe("findFilenameConflicts — lockfiles", () => {
  it("reports two managers' lockfiles in one directory", () => {
    const [c] = findFilenameConflicts(["package.json", "pnpm-lock.yaml", "package-lock.json"])
    expect(c).toMatchObject({ kind: "lockfiles", dir: "" })
    expect(c.labels.sort()).toEqual(["npm", "pnpm"])
  })

  it("says nothing about a single lockfile", () => {
    expect(kinds(["package.json", "pnpm-lock.yaml"])).toEqual([])
  })

  it("says nothing about two files from the same manager", () => {
    // package-lock.json + npm-shrinkwrap.json is milder and npm documents which
    // one wins; the finding here is specifically about disagreeing managers.
    expect(kinds(["package-lock.json", "npm-shrinkwrap.json"])).toEqual([])
  })

  it("does not pair lockfiles across directories", () => {
    // A monorepo package with its own lockfile is unusual but not a conflict
    // with the root one — different trees, different installs.
    expect(kinds(["pnpm-lock.yaml", "packages/api/package-lock.json"])).toEqual([])
  })

  it("reports each conflicting directory separately", () => {
    expect(
      kinds([
        "pnpm-lock.yaml",
        "yarn.lock",
        "packages/api/pnpm-lock.yaml",
        "packages/api/package-lock.json",
      ]),
    ).toEqual(["lockfiles", "lockfiles"])
  })
})

describe("findFilenameConflicts — eslint", () => {
  it("reports a legacy rc file left beside a flat config", () => {
    const [c] = findFilenameConflicts(["eslint.config.mjs", ".eslintrc.json"])
    expect(c).toMatchObject({ kind: "eslint", files: [".eslintrc.json", "eslint.config.mjs"] })
  })

  it("says nothing about a legacy config on its own", () => {
    // ESLint 8 projects are not wrong, they are just older.
    expect(kinds([".eslintrc.js", "package.json"])).toEqual([])
  })

  it("says nothing about a flat config on its own", () => {
    expect(kinds(["eslint.config.ts", "package.json"])).toEqual([])
  })

  it("does not pair a root flat config with a package's rc file", () => {
    expect(kinds(["eslint.config.js", "packages/api/.eslintrc.json"])).toEqual([])
  })
})

describe("findFilenameConflicts — babel", () => {
  it("reports .babelrc beside babel.config.js", () => {
    expect(kinds([".babelrc", "babel.config.js"])).toEqual(["babel"])
  })

  it("says nothing about babel.config.js alone", () => {
    expect(kinds(["babel.config.js"])).toEqual([])
  })
})

describe("findFilenameConflicts — CI providers", () => {
  it("reports a Travis file left beside Actions", () => {
    const [c] = findFilenameConflicts([".github/workflows/ci.yml", ".travis.yml"])
    expect(c).toMatchObject({ kind: "ci", labels: ["Travis CI"] })
  })

  it("reads CircleCI from its own directory", () => {
    expect(kinds([".github/workflows/ci.yaml", ".circleci/config.yml"])).toEqual(["ci"])
  })

  it("says nothing when Travis is the only CI", () => {
    // A project that never moved is not drifting; it is on Travis.
    expect(kinds([".travis.yml", "package.json"])).toEqual([])
  })

  it("says nothing about Actions alone", () => {
    expect(kinds([".github/workflows/ci.yml"])).toEqual([])
  })

  it("does not read a workflow in a nested directory as Actions", () => {
    // Only `.github/workflows/*.yml` is a workflow; anything deeper is not run.
    expect(kinds([".github/workflows/shared/ci.yml", ".travis.yml"])).toEqual([])
  })
})

describe("findPackageKeyConflicts", () => {
  it("reports a prettier key beside a .prettierrc", () => {
    const [c] = findPackageKeyConflicts("package.json", ["name", "prettier"], [
      "package.json",
      ".prettierrc",
    ])
    expect(c).toMatchObject({ kind: "prettier", files: ["package.json", ".prettierrc"] })
  })

  it("matches the config-file form too", () => {
    const out = findPackageKeyConflicts("package.json", ["prettier"], ["prettier.config.js"])
    expect(out.map((c) => c.kind)).toEqual(["prettier"])
  })

  it("says nothing when only the package.json key exists", () => {
    // One place to configure Prettier is the whole point; the key alone is fine.
    expect(findPackageKeyConflicts("package.json", ["prettier"], ["package.json"])).toEqual([])
  })

  it("says nothing when only the file exists", () => {
    expect(findPackageKeyConflicts("package.json", ["name"], [".prettierrc"])).toEqual([])
  })

  it("reports jest the same way", () => {
    const out = findPackageKeyConflicts("package.json", ["jest"], ["jest.config.ts"])
    expect(out.map((c) => c.kind)).toEqual(["jest"])
  })

  it("only looks at files in the package.json's own directory", () => {
    expect(
      findPackageKeyConflicts("packages/api/package.json", ["prettier"], [".prettierrc"]),
    ).toEqual([])
  })
})

describe("findStrictOff", () => {
  it("finds an explicit disable and its line", () => {
    const ts = '{\n  "compilerOptions": {\n    "strict": false\n  }\n}\n'
    expect(findStrictOff(ts)).toBe(3)
  })

  it("says nothing when strict is on", () => {
    expect(findStrictOff('{"compilerOptions":{"strict": true}}')).toBeNull()
  })

  it("says nothing when strict is absent", () => {
    // It may well be inherited through `extends`, which is not resolved here.
    // Guessing would mean accusing a correctly configured project.
    expect(findStrictOff('{"extends":"@tsconfig/node20/tsconfig.json"}')).toBeNull()
  })

  it("ignores a commented-out disable", () => {
    expect(findStrictOff('{\n  // "strict": false,\n  "target": "es2022"\n}')).toBeNull()
  })
})

describe("configConflictScanner", () => {
  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: { blameAgeDays: async () => 400, listBranches: async () => [] },
    }) as unknown as ScanContext

  it("says nothing about a repository with one config each", async () => {
    const issues = await configConflictScanner.run(
      ctx({
        "package.json": JSON.stringify({ name: "widget" }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "eslint.config.mjs": "export default []\n",
        "tsconfig.json": '{"compilerOptions":{"strict":true}}',
        ".github/workflows/ci.yml": "on: push\n",
      }),
    )
    expect(issues).toEqual([])
  })

  it("reports competing lockfiles as a warning", async () => {
    const [issue] = await configConflictScanner.run(
      ctx({
        "package.json": "{}",
        "pnpm-lock.yaml": "",
        "yarn.lock": "",
      }),
    )
    expect(issue.severity).toBe("warning")
    expect(issue.title).toMatch(/Competing lockfiles/)
    expect(issue.category).toBe("hygiene")
  })

  it("reports a dead eslintrc as a warning", async () => {
    const [issue] = await configConflictScanner.run(
      ctx({ "eslint.config.js": "export default []", ".eslintrc.json": "{}" }),
    )
    expect(issue.severity).toBe("warning")
    expect(issue.location).toBe(".eslintrc.json")
    expect(issue.detail).toMatch(/not loaded at all/)
  })

  it("points at the line where strict was turned off", async () => {
    const [issue] = await configConflictScanner.run(
      ctx({ "tsconfig.json": '{\n  "compilerOptions": {\n    "strict": false\n  }\n}' }),
    )
    expect(issue.location).toBe("tsconfig.json:3")
    expect(issue.severity).toBe("info")
  })

  it("does not read a secondary tsconfig", async () => {
    // tsconfig.build.json relaxing a setting is a deliberate variant, not decay.
    const issues = await configConflictScanner.run(
      ctx({ "tsconfig.build.json": '{"compilerOptions":{"strict":false}}' }),
    )
    expect(issues).toEqual([])
  })

  it("survives a malformed package.json", async () => {
    const issues = await configConflictScanner.run(ctx({ "package.json": "{ not json" }))
    expect(issues).toEqual([])
  })

  it("reports a package.json prettier key beside a rc file", async () => {
    const [issue] = await configConflictScanner.run(
      ctx({
        "package.json": JSON.stringify({ name: "w", prettier: { semi: false } }),
        ".prettierrc": "{}",
      }),
    )
    expect(issue.title).toMatch(/Prettier is configured twice/)
  })

  it("gives each finding a stable id per directory", async () => {
    const issues = await configConflictScanner.run(
      ctx({
        "pnpm-lock.yaml": "",
        "yarn.lock": "",
        "packages/api/pnpm-lock.yaml": "",
        "packages/api/package-lock.json": "",
      }),
    )
    expect(issues.map((i) => i.id)).toEqual([
      "config-conflict-lockfiles-root",
      "config-conflict-lockfiles-packages/api",
    ])
  })
})
