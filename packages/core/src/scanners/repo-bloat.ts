import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Repo Bloat scanner.
 *
 * Flags binary blobs and oversized files committed to the working tree — the
 * archives, build artifacts, database dumps and heavy media that bloat clones and
 * almost never belong in version control.
 *
 * Cheap by design: it uses `ctx.fileSize` (fs.stat, no content read) plus the
 * file extension. With no `fileSize` adapter it still flags artifact/binary
 * extensions; only the pure size threshold needs stat. Findings are capped and
 * ranked largest-first so one asset-heavy repo can't flood the report.
 */

const MB = 1024 * 1024
const LARGE_BYTES = 5 * MB // any file this big is suspicious regardless of type
const MEDIA_BYTES = 2 * MB // media is expected to be larger; only flag the heavy ones
const MAX_FINDINGS = 30

// Archives, compiled binaries, installers, db dumps — these rarely belong in git
// at all, so they're flagged regardless of size.
const ARTIFACT_EXT = new Set([
  "zip", "tar", "tgz", "gz", "bz2", "xz", "7z", "rar",
  "jar", "war", "ear", "class",
  "exe", "dll", "so", "dylib", "a", "o", "obj", "lib", "wasm", "pdb",
  "iso", "dmg", "deb", "rpm", "msi", "apk", "appimage",
  "bin", "dat", "pyc", "pyo",
  "dump", "sqlite", "sqlite3", "db", "mdb",
])

// Large media / design files — flagged only above MEDIA_BYTES (legit but heavy).
const MEDIA_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "ico",
  "mp4", "mov", "avi", "mkv", "webm", "wmv", "flv",
  "mp3", "wav", "flac", "ogg", "aac",
  "psd", "ai", "sketch", "fig", "xcf",
])

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
}

function humanSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

interface Candidate {
  file: string
  size: number | null
  severity: Severity
  kind: "artifact" | "large" | "media"
}

export const repoBloatScanner: Scanner = {
  id: "repo-bloat",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const candidates: Candidate[] = []

    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      const ext = extOf(norm)
      const size = ctx.fileSize ? await ctx.fileSize(file) : null

      if (ARTIFACT_EXT.has(ext)) {
        // A binary artifact in git — flag regardless of size.
        candidates.push({ file: norm, size, severity: "warning", kind: "artifact" })
      } else if (size != null && size >= LARGE_BYTES) {
        // Any oversized file (e.g. a giant JSON/CSV fixture) — flag by size.
        candidates.push({ file: norm, size, severity: "warning", kind: "large" })
      } else if (size != null && size >= MEDIA_BYTES && MEDIA_EXT.has(ext)) {
        // Heavy media/design asset — lower-signal, info only.
        candidates.push({ file: norm, size, severity: "info", kind: "media" })
      }
    }

    if (candidates.length === 0) return []

    // Largest first (unknown size sinks to the bottom), then capped.
    candidates.sort((a, b) => (b.size ?? -1) - (a.size ?? -1))

    const issues: Issue[] = []
    for (const c of candidates.slice(0, MAX_FINDINGS)) {
      const sizeStr = c.size != null ? ` (${humanSize(c.size)})` : ""
      let title: string
      let detail: string
      if (c.kind === "artifact") {
        title = `Binary artifact committed: ${c.file}${sizeStr}`
        detail =
          `${c.file} is a binary/archive artifact tracked in git${sizeStr}. These bloat every clone ` +
          `and are rarely meant to be versioned — remove it and add the pattern to .gitignore ` +
          `(use releases or an LFS/artifact store for binaries you must keep).`
      } else if (c.kind === "large") {
        title = `Large file committed: ${c.file}${sizeStr}`
        detail =
          `${c.file} is ${c.size != null ? humanSize(c.size) : "large"} — oversized files balloon the ` +
          `repository and slow clones. Consider Git LFS, an external store, or removing it from history.`
      } else {
        title = `Heavy media asset: ${c.file}${sizeStr}`
        detail =
          `${c.file} is a ${c.size != null ? humanSize(c.size) : "large"} media/design asset in git. ` +
          `If it changes often, Git LFS keeps the repo lean.`
      }

      issues.push({
        id: `bloat-${c.file}`,
        category: "hygiene",
        severity: c.severity,
        title,
        location: c.file,
        ageDays: 0,
        detail,
      })
    }

    return issues
  },
}
