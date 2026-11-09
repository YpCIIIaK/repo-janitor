import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { buildRecord, collectGitData } from "./history.mjs"

test("a history record is built from collected git data alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "history-"))
  try {
    const repo = join(root, "r")
    const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" })
    mkdirSync(join(repo, ".github/workflows"), { recursive: true })
    execFileSync("git", ["init", "--quiet", repo])
    writeFileSync(join(repo, "Dockerfile"), "FROM node:22-alpine AS build\nFROM build\n")
    writeFileSync(join(repo, ".github/workflows/ci.yml"), "jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v3\n")
    writeFileSync(join(repo, "AGENTS.md"), "x\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "one")
    const sha = git("rev-parse", "HEAD").trim()

    const data = await collectGitData(repo, sha)
    assert.deepEqual([...data.tree].sort(), [".github/workflows/ci.yml", "AGENTS.md", "Dockerfile"])
    assert.ok(data.files["Dockerfile"].includes("node:22-alpine"))

    const out = join(root, "rec.json")
    const rec = buildRecord({ name: "r", url: "u", sha }, data, out)
    assert.ok(existsSync(out))
    assert.equal(rec.practices.aiAgents.present, true)
    assert.equal(rec.practices.docker.present, true)
    assert.equal(rec.actions["actions/checkout"], 3)
    assert.deepEqual(rec.dockerBases, ["node:22-alpine"]) // the build stage is not a base image
    assert.equal(rec.authorsTotal, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
