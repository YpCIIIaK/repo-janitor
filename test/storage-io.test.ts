import { expect, it } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withStorageLock, writeJsonAtomic } from "@/lib/storage-io"

it("serializes competing read-modify-write updates without losing writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rar-atomic-"))
  const file = join(dir, "state.json")
  try {
    await writeJsonAtomic(file, { count: 0 })
    await Promise.all(Array.from({ length: 20 }, () => withStorageLock(async () => {
      const data = JSON.parse(await readFile(file, "utf8"))
      await writeJsonAtomic(file, { count: data.count + 1 })
    })))
    expect(JSON.parse(await readFile(file, "utf8")).count).toBe(20)
    await expect(withStorageLock(async () => { throw new Error("failed write") })).rejects.toThrow()
    expect(await withStorageLock(async () => "still usable")).toBe("still usable")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
