import { afterEach, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { POST } from "@/app/api/admin/backup/route"
import { run } from "@/lib/clone-runner"

let dir: string | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (dir && resolve(dir).startsWith(resolve(tmpdir()) + sep)) await rm(dir, { recursive: true, force: true })
})

it("backs up authenticated local data and restores it to a separate directory", async () => {
  dir = await mkdtemp(join(tmpdir(), "rar-backup-test-"))
  const data = join(dir, "data")
  const backups = join(dir, "backups")
  const restored = join(dir, "restored")
  await mkdir(data)
  await mkdir(restored)
  await writeFile(join(data, "reports.json"), JSON.stringify({ reports: [{ id: "preserved" }] }))
  vi.stubEnv("REPO_ANTI_ROT_DATA_DIR", data)
  vi.stubEnv("REPO_ANTI_ROT_BACKUP_DIR", backups)
  vi.stubEnv("CRON_SECRET", "backup-test-secret")
  expect((await POST(new Request("http://localhost/api/admin/backup", { method: "POST" }))).status).toBe(401)
  const response = await POST(new Request("http://localhost/api/admin/backup", { method: "POST", headers: { Authorization: "Bearer backup-test-secret" } }))
  expect(response.status).toBe(200)
  const { file } = await response.json()
  const unpack = await run("tar", ["-xzf", join(backups, file), "-C", restored], { timeoutMs: 10_000 })
  expect(unpack.code).toBe(0)
  expect(JSON.parse(await readFile(join(restored, "reports.json"), "utf8"))).toEqual({ reports: [{ id: "preserved" }] })
  vi.stubEnv("REPO_ANTI_ROT_BACKUP_DIR", join(data, "..hidden"))
  expect((await POST(new Request("http://localhost/api/admin/backup", { method: "POST", headers: { Authorization: "Bearer backup-test-secret" } }))).status).toBe(500)
}, 20_000)
