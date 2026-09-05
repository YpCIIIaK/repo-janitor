import { join, resolve } from "node:path"

/** Mount this directory as a persistent volume when self-hosting. */
export function dataDir(): string {
  return process.env.REPO_ANTI_ROT_DATA_DIR?.trim()
    ? resolve(/* turbopackIgnore: true */ process.env.REPO_ANTI_ROT_DATA_DIR.trim())
    : join(process.cwd(), ".repo-anti-rot")
}
