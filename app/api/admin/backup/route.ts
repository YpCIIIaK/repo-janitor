import { NextResponse } from "next/server"
import { mkdir, readdir, rm } from "node:fs/promises"
import { join, resolve, relative, isAbsolute, sep } from "node:path"
import { checkBearer } from "@/lib/api-auth"
import { dataDir } from "@/lib/data-dir"
import { withStorageLock } from "@/lib/storage-io"
import { run } from "@/lib/clone-runner"

export const runtime = "nodejs"

/** Fixed-path, authenticated backup; no client-supplied paths or commands. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || !checkBearer(request, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const file = await withStorageLock(async () => {
      const dir = process.env.REPO_ANTI_ROT_BACKUP_DIR
        ? resolve(/* turbopackIgnore: true */ process.env.REPO_ANTI_ROT_BACKUP_DIR)
        : join(process.cwd(), "backups")
      const rel = relative(dataDir(), dir)
      if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) throw new Error("Backup directory must be outside data directory")
      await mkdir(dir, { recursive: true })
      await mkdir(dataDir(), { recursive: true })
      const file = `repo-anti-rot-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`
      const result = await run("tar", ["-czf", join(dir, file), "-C", dataDir(), "."], { timeoutMs: 120_000 })
      if (result.code !== 0) {
        await rm(join(dir, file), { force: true }).catch(() => {})
        throw new Error("Archive failed")
      }
      const files = (await readdir(dir)).filter((name) => /^repo-anti-rot-\d{4}-\d{2}-\d{2}T[\dTZ-]+\.tar\.gz$/.test(name)).sort().reverse()
      for (const name of files.slice(14)) await rm(join(dir, name), { force: true })
      return file
    })
    return NextResponse.json({ ok: true, file, scope: "local data directory; external Supabase requires a separate database backup" })
  } catch {
    return NextResponse.json({ error: "Backup failed; verify writable backup storage and tar availability" }, { status: 500 })
  }
}
