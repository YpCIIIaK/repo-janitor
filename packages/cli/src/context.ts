import { promises as fs } from "fs";
import fg from "fast-glob";
import simpleGit, { SimpleGit } from "simple-git";
import { runScan, loadConfig } from "@repo-anti-rot/core";
import type { ScanContext, ScanReport, ScanProgress } from "@repo-anti-rot/core";
import { basename, join } from "path";

/**
 * Node implementation of the engine's `ScanContext` (fast-glob + simple-git +
 * fetch). Lives here, not in the bin, so both the CLI and the GitHub Action build
 * the exact same context. Keep all IO in this file.
 */

export interface RepoMetadata {
  owner: string;
  name: string;
  defaultBranch: string;
  /** HEAD commit SHA at scan time (undefined if not a git repo) — for permalinks. */
  commit?: string;
}

export async function getRepoMetadata(git: SimpleGit, root: string): Promise<RepoMetadata> {
  // Local-repo fallback: derive a readable name from the folder rather than
  // "unknown-repo", so scanning a repo without a GitHub remote still reads well.
  const folderName = basename(root) || "local-repo";

  // Best-effort current branch (works for any git repo, even with no remote).
  const currentBranch = async (): Promise<string> => {
    try {
      const branch = await git.branch();
      return branch.current || "main";
    } catch {
      return "main";
    }
  };

  // Best-effort HEAD commit SHA — used to build frozen GitHub permalinks.
  const headSha = async (): Promise<string | undefined> => {
    try {
      const sha = await git.revparse(["HEAD"]);
      return sha.trim() || undefined;
    } catch {
      return undefined;
    }
  };

  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    const remoteUrl = origin?.refs?.push || origin?.refs?.fetch;

    if (remoteUrl) {
      // git@github.com:owner/repo.git  OR  https://host/owner/repo.git
      const match =
        remoteUrl.match(/git@[^:]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/) ||
        remoteUrl.match(/[^\/]+:\/\/[^\/]+\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
      if (match) {
        const [, owner, name] = match;
        return { owner, name, defaultBranch: await currentBranch(), commit: await headSha() };
      }
    }

    // Git repo but no parseable remote → use the folder name under a "local" owner.
    return { owner: "local", name: folderName, defaultBranch: await currentBranch(), commit: await headSha() };
  } catch {
    // Not a git repo (or git unavailable) → still produce a usable identity.
    return { owner: "local", name: folderName, defaultBranch: "main" };
  }
}

export async function buildScanContext(root: string): Promise<ScanContext> {
  const git = simpleGit(root);

  // Get repository metadata
  const repo = await getRepoMetadata(git, root);

  // Per-project config (.repo-anti-rot.json) — defaults when absent/invalid.
  const readRel = async (relPath: string): Promise<string | null> => {
    try {
      return await fs.readFile(join(root, relPath), "utf-8");
    } catch {
      return null;
    }
  };
  const config = await loadConfig(readRel, (msg) => console.warn(`[repo-anti-rot] ${msg}`));

  // Get list of files (excluding node_modules, .git, etc. plus user ignore globs)
  const files = await fg([
    "**/*",
    "!**/node_modules/**",
    "!**/.git/**",
    "!**/dist/**",
    "!**/build/**",
    "!**/coverage/**",
    "!**/.next/**",
    "!**/*.log"
  ], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: config.ignore,
  });

  return {
    root,
    repo,
    config,
    files,
    readFile: readRel,
    fileSize: async (relPath: string): Promise<number | null> => {
      try {
        const stat = await fs.stat(join(root, relPath));
        return stat.isFile() ? stat.size : null;
      } catch {
        return null;
      }
    },
    git: {
      blameAgeDays: async (relPath: string, line: number): Promise<number> => {
        try {
          // simple-git has no `.blame()` helper, so drive porcelain blame through
          // `raw` and read the `committer-time` epoch from the header block. The
          // `-L a,b` range limits blame to the single line we care about; `--`
          // keeps paths that look like options unambiguous.
          const out = await git.raw([
            "blame",
            "--porcelain",
            "-L",
            `${line},${line}`,
            "--",
            relPath,
          ]);
          const m = out.match(/^committer-time (\d+)/m);
          if (!m) return 0;
          const commitMs = parseInt(m[1], 10) * 1000;
          const ageDays = Math.floor((Date.now() - commitMs) / (1000 * 60 * 60 * 24));
          return Math.max(0, ageDays);
        } catch {
          // uncommitted line, file not in git, or git unavailable → unknown age
          return 0;
        }
      },
      listBranches: async (): Promise<{ name: string; lastCommit: string; behind: number; ageDays: number }[]> => {
        try {
          const branches = await git.branch(['--all', '--no-color']);
          const remoteBranches = branches.all
            .filter(branch => branch.startsWith('remotes/origin/') && !branch.includes('HEAD'))
            .map(branch => branch.replace('remotes/origin/', ''));

          const result = [];
          for (const branchName of remoteBranches) {
            try {
              // Last commit hash + timestamp on this branch → ageDays since inactivity
              const logResult = await git.log([branchName, '-1', '--format=%H,%ct']);
              const logLines = (logResult as any).all || [];
              if (logLines.length === 0) {
                result.push({ name: branchName, lastCommit: "unknown", behind: 0, ageDays: 0 });
                continue;
              }

              const [hash, timestampStr] = logLines[0].split(',');
              const timestamp = parseInt(timestampStr, 10) * 1000;
              const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24)));

              // Commits this branch is behind the default branch (0 if up to date / unknown)
              let behind = 0;
              try {
                const count = await git.raw([
                  'rev-list',
                  '--count',
                  `${branchName}..origin/${repo.defaultBranch}`,
                ]);
                behind = Math.max(0, parseInt(count.trim(), 10) || 0);
              } catch {
                // default branch ref may be missing locally — leave behind = 0
              }

              result.push({ name: branchName, lastCommit: hash, behind, ageDays });
            } catch (err) {
              result.push({ name: branchName, lastCommit: "unknown", behind: 0, ageDays: 0 });
            }
          }
          return result;
        } catch (err) {
          return [];
        }
      },
      fileOwnership: async (): Promise<Record<string, { authors: number; ageDays: number }>> => {
        try {
          // One pass over history. \x01 marks a commit header, \x02 splits
          // author|timestamp — control chars so author names can't collide with
          // the delimiter. core.quotePath=false keeps unicode paths readable.
          const out = await git.raw([
            '-c', 'core.quotePath=false',
            'log', '--no-merges', '--format=%x01%an%x02%ct', '--name-only',
          ]);

          const acc = new Map<string, { authors: Set<string>; last: number }>();
          let author = '';
          let ts = 0;
          for (const line of out.split('\n')) {
            if (line.startsWith('\x01')) {
              const [an, ct] = line.slice(1).split('\x02');
              author = an ?? '';
              ts = (parseInt(ct ?? '0', 10) || 0) * 1000;
            } else {
              const file = line.trim();
              if (!file) continue;
              let entry = acc.get(file);
              if (!entry) {
                entry = { authors: new Set<string>(), last: 0 };
                acc.set(file, entry);
              }
              entry.authors.add(author);
              if (ts > entry.last) entry.last = ts;
            }
          }

          const now = Date.now();
          const result: Record<string, { authors: number; ageDays: number }> = {};
          for (const [file, entry] of acc) {
            result[file] = {
              authors: entry.authors.size,
              ageDays: Math.max(0, Math.floor((now - entry.last) / (1000 * 60 * 60 * 24))),
            };
          }
          return result;
        } catch {
          return {};
        }
      },
    },
    fetchJson: async (url: string): Promise<unknown | null> => {
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "repo-anti-rot (https://github.com/YpCIIIaK/repo-janitor)" },
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        // offline / network error → caller degrades to offline mode
        return null;
      }
    },
    postJson: async (url: string, body: unknown): Promise<unknown | null> => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "repo-anti-rot (https://github.com/YpCIIIaK/repo-janitor)",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        // offline / network error → caller degrades to offline mode
        return null;
      }
    },
    log: (msg: string) => {
      console.log(`[repo-anti-rot] ${msg}`);
    }
  };
}

/** Scan a single repository path and return its validated report. */
export async function scanRepo(
  root: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanReport> {
  const ctx = await buildScanContext(root);
  return runScan(ctx, undefined, onProgress);
}
