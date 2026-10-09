// Opt-in smoke test: build first, then node scripts/test-background-scan.mjs.
// Uses a private temporary filesystem store, NEVER the configured Supabase.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import assert from "node:assert/strict"
const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), "repo-janitor-job-smoke-"))
const origin = "http://127.0.0.1:3107"
let server
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function start() {
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "3107", "-H", "127.0.0.1"], {
    env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", PUBLIC_ORIGIN: origin, REPO_ANTI_ROT_DATA_DIR: root },
    stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
  })
  server.stderr.on("data", () => {})
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Smoke server exited before readiness")
    try { if ((await fetch(`${origin}/api/health`)).ok) return } catch { /* startup can refuse connections */ }
    await pause(500)
  }
  throw new Error("Smoke server did not start")
}
async function stop() {
  if (!server || server.exitCode !== null) return
  const exited = new Promise((r) => server.once("exit", r))
  server.kill()
  await exited
}
try {
  await start()
  const id = randomBytes(32).toString("hex")
  const controller = new globalThis.AbortController()
  const submit = () => fetch(`${origin}/api/scan`, {
    method: "POST", headers: { "content-type": "application/json", origin, "x-scan-job": id },
    body: JSON.stringify({ urls: ["https://github.com/octocat/Hello-World"], only: ["project-hygiene"] }), signal: controller.signal,
  })
  const accepted = await submit()
  assert.equal(accepted.status, 202)
  await accepted.json()
  controller.abort() // detached work must not inherit this signal
  await pause(2000)
  let finished
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${origin}/api/scan/job`, { headers: { Authorization: `Bearer ${id}` } })
    assert.equal(response.status, 200)
    const job = await response.json()
    if (["completed", "failed"].includes(job.status)) { finished = job; break }
    await pause(2000)
  }
  assert.equal(finished?.status, "completed", finished?.error ?? finished?.results?.[0]?.error)
  assert.equal(finished.results[0].ok, true)
  assert.ok(finished.archiveInfo.compressedBytes < finished.archiveInfo.originalBytes)
  const unauthenticated = await fetch(`${origin}/api/scan/job`)
  assert.equal(unauthenticated.status, 404)
  await stop()
  await start()
  const restored = await (await fetch(`${origin}/api/scan/job`, { headers: { Authorization: `Bearer ${id}` } })).json()
  assert.deepEqual(restored.results, finished.results)
  console.log(JSON.stringify({ smoke: "passed", disconnectedClient: true, restoredAfterRestart: true, scanners: finished.results[0].report.diagnostics, archive: finished.archiveInfo }))
} finally {
  await stop()
  // Remove only the specific directory created by this test, never a broad path.
  assert.equal(dirname(resolve(root)), resolve(tmpdir()), "Unsafe test cleanup parent")
  assert.ok(root.includes("repo-janitor-job-smoke-"), "Unsafe test cleanup name")
  await rm(root, { recursive: true, force: true })
}
