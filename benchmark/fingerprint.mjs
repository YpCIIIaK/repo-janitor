/**
 * Fingerprint of the code that decides what a scan finds: every source file of
 * the core engine and scanners and of the CLI, except the generated confidence
 * data. Confidence changes the score and what is shown by default, not the
 * findings themselves, so updating labels must not make 3,000 results stale —
 * `rescore.mjs` reapplies it to stored findings instead.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCES = ["packages/core/src", "packages/cli/src"]
const EXCLUDED = new Set(["packages/core/src/confidence-data.ts"])

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|js|mjs|json)$/.test(e.name)) out.push(p)
  }
  return out
}

export function sourceFiles() {
  return SOURCES.flatMap((d) => walk(join(root, d)))
    .filter((p) => !EXCLUDED.has(relative(root, p)))
    .sort()
}

export function scanFingerprint() {
  const h = createHash("sha256")
  for (const p of sourceFiles()) {
    h.update(relative(root, p))
    h.update("\0")
    h.update(readFileSync(p))
    h.update("\0")
  }
  return h.digest("hex").slice(0, 16)
}

/** Newest modification time among the fingerprinted sources. */
export function newestSource() {
  return Math.max(...sourceFiles().map((p) => statSync(p).mtimeMs))
}
