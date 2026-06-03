import { promises as fs } from "fs";
import fg from "fast-glob";
import simpleGit, { SimpleGit } from "simple-git";
import { runScan } from "@repo-anti-rot/core";
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
        return { owner, name, defaultBranch: await currentBranch() };
      }
    }

    // Git repo but no parseable remote → use the folder name under a "local" owner.
    return { owner: "local", name: folderName, defaultBranch: await currentBranch() };
  } catch {
    // Not a git repo (or git unavailable) → still produce a usable identity.
    return { owner: "local", name: folderName, defaultBranch: "main" };
  }
}

export async function buildScanContext(root: string): Promise<ScanContext> {
  const git = simpleGit(root);

  // Get repository metadata
  const repo = await getRepoMetadata(git, root);

  // Get list of files (excluding node_modules, .git, etc.)
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
    onlyFiles: true
  });

  return {
    root,
    repo,
    files,
    readFile: async (relPath: string): Promise<string | null> => {
      try {
        const content = await fs.readFile(join(root, relPath), "utf-8");
        return content;
      } catch (err) {
        return null;
      }
    },
    git: {
      blameAgeDays: async (relPath: string, line: number): Promise<number> => {
        try {
          // Use any type to avoid TS error until we fix typings
          const blameOutput = await (git as any).blame([`-L${line},${line}`, relPath]);
          if (!blameOutput || blameOutput.length === 0) {
            return 0;
          }

          const commitTimestamp = blameOutput[0].date.getTime();
          const now = Date.now();
          const ageDays = Math.floor((now - commitTimestamp) / (1000 * 60 * 60 * 24));
          return Math.max(0, ageDays);
        } catch (err) {
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
      }
    },
    fetchJson: async (url: string): Promise<unknown | null> => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
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
