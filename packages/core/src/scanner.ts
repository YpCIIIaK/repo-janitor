import type { Issue, IssueCategory } from "./schema"
import type { ResolvedConfig } from "./config"

/**
 * Context handed to every scanner. Keep all IO (fs, git, network) behind this
 * object so scanners stay pure and easy to test / swap implementations.
 */
export interface ScanContext {
  /** absolute path to the repository root */
  root: string
  /** repo metadata, usually derived from git remote */
  repo: { owner: string; name: string; defaultBranch: string; commit?: string }
  /** resolved per-project config (.repo-anti-rot.json); defaults when absent */
  config?: ResolvedConfig
  /** resolved list of project files (already glob-filtered, excludes node_modules/.git) */
  files: string[]
  /** read a file relative to root; returns null if missing */
  readFile: (relPath: string) => Promise<string | null>
  /**
   * Optional: byte size of a file without reading its contents (fs.stat). Lets
   * scanners flag large/binary blobs cheaply. Returns null if unavailable or on
   * error; scanners must degrade (e.g. fall back to extension-only heuristics).
   */
  fileSize?: (relPath: string) => Promise<number | null>
  /** thin git adapter — wrap simple-git/isomorphic-git so it can be replaced */
  git: {
    blameAgeDays: (relPath: string, line: number) => Promise<number>
    /**
     * Remote branches with decay signals:
     *  - `behind`  : commits this branch is behind the default branch (0 = up to date)
     *  - `ageDays` : days since this branch's last commit (staleness by inactivity)
     */
    listBranches: () => Promise<
      { name: string; lastCommit: string; behind: number; ageDays: number }[]
    >
    /**
     * Optional ownership map for bus-factor analysis: repo-relative file path →
     * distinct author count plus days since its last commit. Built from a single
     * `git log` pass. Omitted when git is unavailable; callers must degrade.
     */
    fileOwnership?: () => Promise<Record<string, { authors: number; ageDays: number }>>
  }
  /**
   * Optional network adapter for registry lookups (e.g. npm). Returns parsed JSON
   * or null on any failure. When omitted, network-using scanners run in offline
   * mode (lockfile/static analysis only) instead of failing.
   */
  fetchJson?: (url: string) => Promise<unknown | null>
  /**
   * Optional network adapter for JSON POST requests (e.g. the OSV vulnerability
   * batch API). Returns parsed JSON or null on any failure. When omitted, scanners
   * that need POST run in offline mode (skip the network-derived findings).
   */
  postJson?: (url: string, body: unknown) => Promise<unknown | null>
  /** structured logger; no-op in tests */
  log: (msg: string) => void
}

/**
 * Plugin contract. Add a new scanner by implementing this and registering it
 * in the engine — no changes to engine internals required.
 */
export interface Scanner {
  id: string
  category: IssueCategory
  /** return the issues found; throwing is allowed and isolated per-scanner */
  run(ctx: ScanContext): Promise<Issue[]>
}
