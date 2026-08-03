#!/usr/bin/env node
/**
 * Refresh lib/proof-snapshot.json by cloning each proof repo and scanning the path.
 *
 *   pnpm proof:refresh
 *
 * Requires a built CLI (`pnpm run build:cli`), git, and network.
 */

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const proofReposPath = join(root, "lib", "proof-repos.ts")
const outPath = join(root, "lib", "proof-snapshot.json")
const cli = join(root, "packages", "cli", "dist", "index.js")

/** Parse PROOF_REPOS urls from the TS source (no TS loader needed). */
function loadProofUrls() {
  const src = readFileSync(proofReposPath, "utf8")
  const urls = [...src.matchAll(/url:\s*"(https:\/\/github\.com\/[^"]+)"/g)].map((m) => m[1])
  if (urls.length === 0) throw new Error("No proof repo URLs found in lib/proof-repos.ts")
  return urls
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })
}

/**
 * Clone shallow → scan path with -o → parse report JSON → cleanup.
 * Returns the report or null on failure.
 */
function scanOne(url) {
  // Parent holds the clone + the report file. The report must sit *outside*
  // the scanned tree so the CLI does not treat it as repo content.
  const parent = mkdtempSync(join(tmpdir(), "proof-"))
  const dir = join(parent, "repo")
  const reportFile = join(parent, "report.json")
  try {
    const clone = run(
      "git",
      ["clone", "--depth", "1", "--single-branch", url, dir],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    if (clone.status !== 0) {
      console.error(`FAIL clone ${url}\n${clone.stderr || ""}`)
      return null
    }

    const scan = run(process.execPath, [cli, "scan", dir, "-f", "json", "-o", reportFile], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (scan.status !== 0) {
      console.error(`FAIL scan ${url}\n${scan.stderr || scan.stdout || ""}`)
      return null
    }

    if (!existsSync(reportFile)) {
      console.error(`FAIL ${url}: CLI did not write ${reportFile}`)
      return null
    }

    try {
      return JSON.parse(readFileSync(reportFile, "utf8"))
    } catch (err) {
      console.error(`Parse error for ${url}:`, err)
      return null
    }
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

if (!existsSync(cli)) {
  console.error(`CLI not built: ${cli}\nRun: pnpm run build:cli`)
  process.exit(1)
}

const urls = loadProofUrls()
const repos = []
let failed = 0

for (const url of urls) {
  console.log(`Scanning ${url} …`)
  const report = scanOne(url)
  if (!report?.repo || typeof report.score !== "number" || !report.grade) {
    failed++
    continue
  }
  repos.push({
    owner: report.repo.owner,
    name: report.repo.name,
    grade: report.grade,
    score: report.score,
  })
  console.log(`  → ${report.repo.owner}/${report.repo.name}  ${report.grade} ${report.score}`)
}

if (failed > 0 || repos.length !== urls.length) {
  console.error(
    `Aborting: ${failed} failed, ${repos.length}/${urls.length} ok — snapshot not updated.`,
  )
  process.exit(1)
}

const snap = { updatedAt: new Date().toISOString(), repos }
writeFileSync(outPath, `${JSON.stringify(snap, null, 2)}\n`)
console.log(`Wrote ${repos.length} repos → ${outPath}`)
