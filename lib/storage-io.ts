import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

const state = globalThis as typeof globalThis & { rarStorageQueue?: Promise<unknown> }

/** Serialize read-modify-write operations in the single application process. */
export function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = (state.rarStorageQueue ?? Promise.resolve()).then(operation, operation)
  state.rarStorageQueue = next.catch(() => {})
  return next
}

/** Readers see either the previous complete file or the new complete file. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 })
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}
