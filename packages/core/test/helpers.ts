import type { ScanContext } from "../src/scanner"
import type { ResolvedConfig } from "../src/config"
import { defaultConfig } from "../src/config"

/**
 * Test harness: build a fake {@link ScanContext} backed by an in-memory file map.
 *
 * Scanners take all their IO (fs, git, network) through the context, so we can
 * exercise them with no real filesystem/git/network — fast and deterministic.
 *
 * `files` is the map of repo-relative path → contents. The file list handed to
 * scanners (`ctx.files`) is derived from its keys unless overridden. Git, sizes
 * and network adapters default to harmless stubs; override any of them per test.
 */
export interface FakeContextOptions {
  /** repo-relative path → file contents */
  files?: Record<string, string>
  /** explicit file list; defaults to Object.keys(files) */
  fileList?: string[]
  repo?: Partial<ScanContext["repo"]>
  config?: ResolvedConfig
  /** byte sizes by path (fileSize adapter); falls back to utf-8 byte length of contents */
  sizes?: Record<string, number>
  /** git.blameAgeDays result by `path:line` or path; default 0 */
  blameAges?: Record<string, number>
  /** git.listBranches result; default [] */
  branches?: Awaited<ReturnType<ScanContext["git"]["listBranches"]>>
  /** git.fileOwnership result; omitted (undefined) by default */
  ownership?: Record<string, { authors: number; ageDays: number }>
  /** fetchJson responses keyed by url; omitted adapter when not provided */
  fetchJson?: Record<string, unknown>
  /** postJson responses keyed by url; omitted adapter when not provided */
  postJson?: Record<string, unknown>
  /** collect log lines here if provided */
  logs?: string[]
}

export function makeContext(opts: FakeContextOptions = {}): ScanContext {
  const files = opts.files ?? {}
  const fileList = opts.fileList ?? Object.keys(files)

  const ctx: ScanContext = {
    root: "/repo",
    repo: {
      owner: "acme",
      name: "widget",
      defaultBranch: "main",
      ...opts.repo,
    },
    config: opts.config ?? defaultConfig(),
    files: fileList,
    readFile: async (relPath) => {
      const norm = relPath.replace(/\\/g, "/")
      return files[relPath] ?? files[norm] ?? null
    },
    fileSize: async (relPath) => {
      const norm = relPath.replace(/\\/g, "/")
      if (opts.sizes && (relPath in opts.sizes || norm in opts.sizes)) {
        return opts.sizes[relPath] ?? opts.sizes[norm]
      }
      const content = files[relPath] ?? files[norm]
      return content === undefined ? null : Buffer.byteLength(content, "utf-8")
    },
    git: {
      blameAgeDays: async (relPath, line) => {
        const ages = opts.blameAges ?? {}
        return ages[`${relPath}:${line}`] ?? ages[relPath] ?? 0
      },
      listBranches: async () => opts.branches ?? [],
      ...(opts.ownership ? { fileOwnership: async () => opts.ownership! } : {}),
    },
    ...(opts.fetchJson
      ? { fetchJson: async (url: string) => opts.fetchJson![url] ?? null }
      : {}),
    ...(opts.postJson
      ? { postJson: async (url: string) => opts.postJson![url] ?? null }
      : {}),
    log: (msg) => {
      opts.logs?.push(msg)
    },
  }

  return ctx
}
