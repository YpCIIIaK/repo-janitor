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

// --- per-scanner fingerprints -------------------------------------------------
// A scanner's findings depend on its own module, everything it imports (at
// runtime: `import type` changes nothing), and a shared base: the CLI that
// builds the scan context and the engine around the scanners. Changing one
// scanner then invalidates only that scanner's cached findings; adding a new
// scanner invalidates nothing (it simply has no cache yet).

const CORE = join(root, "packages/core/src")
/** Engine-side modules that stamp or filter every finding. */
const BASE_CORE = ["engine.ts", "scanner.ts", "schema.ts", "rules.ts", "config.ts", "profile.ts"]

function resolveImport(from, spec) {
  const base = join(dirname(from), spec)
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
    try { if (statSync(c).isFile()) return c } catch { /* next */ }
  }
  return null
}

/** Runtime imports of a module, transitively, within the core. */
function closure(file, seen = new Set()) {
  if (seen.has(file) || EXCLUDED.has(relative(root, file))) return seen
  try { statSync(file) } catch { return seen }
  seen.add(file)
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
    if (m[2]) continue // type-only
    const target = resolveImport(file, m[3])
    if (target) closure(target, seen)
  }
  return seen
}

/** Engine source without the scanner registry, so adding a scanner is not a base change. */
function engineWithoutRegistry() {
  let text = ""
  try { text = readFileSync(join(CORE, "engine.ts"), "utf8") } catch { return "" }
  return text
    .replace(/^import \{ \w+Scanner \} from "\.\/scanners\/[^"]+"\n/gm, "")
    .replace(/export const defaultScanners: Scanner\[\] = \[[\s\S]*?\n\]\n/, "")
}

function hashFiles(files, extra = "") {
  const h = createHash("sha256")
  h.update(extra)
  for (const p of [...files].sort()) {
    h.update(relative(root, p))
    h.update("\0")
    h.update(p.endsWith("/engine.ts") ? engineWithoutRegistry() : readFileSync(p))
    h.update("\0")
  }
  return h.digest("hex").slice(0, 16)
}

/** id → module file for every registered scanner. */
export function scannerModules() {
  const out = {}
  let files = []
  try { files = readdirSync(join(CORE, "scanners")) } catch { return out }
  for (const f of files.filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(CORE, "scanners", f), "utf8")
    const m = /export const \w+Scanner: Scanner = \{\s*id:\s*"([\w-]+)"/.exec(text)
    if (m) out[m[1]] = join(CORE, "scanners", f)
  }
  return out
}

export function scannerFingerprints() {
  const baseFiles = new Set(walk(join(root, "packages/cli/src")))
  for (const f of BASE_CORE) {
    const p = join(CORE, f)
    for (const dep of f === "engine.ts" ? [p] : closure(p)) baseFiles.add(dep)
  }
  // The engine's own non-scanner imports belong to the base too.
  for (const m of engineWithoutRegistry().matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const t = resolveImport(join(CORE, "engine.ts"), m[1])
    if (t && !EXCLUDED.has(relative(root, t))) for (const dep of closure(t)) baseFiles.add(dep)
  }
  const base = hashFiles(baseFiles)
  const scanners = {}
  for (const [id, file] of Object.entries(scannerModules())) {
    const files = [...closure(file)].filter((f) => !baseFiles.has(f))
    scanners[id] = hashFiles(files, base)
  }
  return { base, scanners }
}

/**
 * Which scanners must rerun for a repo, given its previous result:
 * null → a full scan (no usable result, other commit, or the base changed);
 * []   → nothing, the result is current;
 * ids  → only these scanners.
 */
export function staleScanners(prev, sha, fps, globalFp) {
  if (!prev || prev.sha !== sha) return null
  if (prev.scanners && prev.base) {
    if (prev.base !== fps.base) return null
    return Object.keys(fps.scanners).filter((id) => prev.scanners[id] !== fps.scanners[id])
  }
  // Results written before per-scanner fingerprints: current only if the whole
  // scanner code is unchanged since they were stamped.
  return prev.fingerprint && prev.fingerprint === globalFp ? [] : null
}
