#!/usr/bin/env node

import { Command } from "commander";
import { promises as fs } from "fs";
import { renderReport, normalizeFormat } from "@repo-anti-rot/core";
import type { ScanReport } from "@repo-anti-rot/core";
import { join } from "path";
import { scanRepo } from "./context";

/** Render a report as the requested string format (json | terminal | md). */
function serializeReport(report: ScanReport, format: string): string {
  return renderReport(report, format);
}

/**
 * Discover immediate subdirectories of `dir` that are git repositories
 * (contain a `.git` entry). Returns them sorted by name.
 */
async function discoverRepos(dir: string): Promise<{ name: string; path: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const repos: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    try {
      await fs.stat(join(path, ".git"));
      repos.push({ name: entry.name, path });
    } catch {
      // not a git repo, skip
    }
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/** Make a filesystem-safe report filename for a repo. */
function reportFileName(dirName: string, format: string): string {
  const safe = dirName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const ext = { json: "json", md: "md", terminal: "txt" }[normalizeFormat(format)];
  return `${safe}.${ext}`;
}

function registerScan(program: Command) {
  program
    .command("scan")
    .description("Scan a single repository for health and decay metrics")
    .option("-p, --path <path>", "Path to repository to scan", ".")
    .option("-f, --format <format>", "Output format (json, terminal, md)", "terminal")
    .option("-o, --output <file>", "Output file path")
    .option("--progress", "Emit machine-readable progress events to stderr")
    .action(async (options) => {
      try {
        const root = await fs.realpath(options.path);
        console.log(`Scanning repository at: ${root}`);

        // With --progress, stream one NDJSON line per scanner to stderr so a parent
        // process (the dashboard's /api/scan) can render real progress.
        const onProgress = options.progress
          ? (p: { scanner?: string; completed: number; total: number }) =>
              process.stderr.write(`@@PROGRESS@@${JSON.stringify(p)}\n`)
          : undefined;

        const report = await scanRepo(root, onProgress);
        const output = serializeReport(report, options.format);

        if (options.output) {
          await fs.writeFile(options.output, output, "utf-8");
          console.log(`Results written to: ${options.output}`);
        } else {
          console.log(output);
        }
      } catch (err) {
        console.error("Error during scan:", err);
        process.exit(1);
      }
    });
}

function registerBatch(program: Command) {
  program
    .command("batch")
    .description("Scan many repositories under a directory, one report per repo")
    .argument("<dir>", "Directory containing cloned repositories (each a subfolder)")
    .option("-f, --format <format>", "Report format (json, terminal, md)", "json")
    .option("-o, --out-dir <dir>", "Write one report file per repo into this directory")
    .option("-r, --repos <names>", "Only scan these subfolders (comma-separated)")
    .option("-l, --limit <n>", "Scan at most N repositories", (v) => parseInt(v, 10))
    .action(async (dir: string, options) => {
      try {
        const base = await fs.realpath(dir);
        let repos = await discoverRepos(base);

        if (options.repos) {
          const wanted = new Set(
            String(options.repos)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
          repos = repos.filter((r) => wanted.has(r.name));
        }

        if (Number.isFinite(options.limit) && options.limit > 0) {
          repos = repos.slice(0, options.limit);
        }

        if (repos.length === 0) {
          console.error(`No git repositories found to scan under: ${base}`);
          process.exit(1);
        }

        if (options.outDir) {
          await fs.mkdir(options.outDir, { recursive: true });
        }

        console.log(`Found ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} to scan under ${base}\n`);

        const summary: { name: string; score: number | null; grade: string; issues: number; error?: string }[] = [];

        // Scan sequentially so progress is readable and memory stays flat.
        for (let i = 0; i < repos.length; i++) {
          const repo = repos[i];
          const prefix = `[${i + 1}/${repos.length}] ${repo.name}`;
          try {
            const report = await scanRepo(repo.path);
            const output = serializeReport(report, options.format);

            if (options.outDir) {
              const file = join(options.outDir, reportFileName(repo.name, options.format));
              await fs.writeFile(file, output, "utf-8");
              console.log(`${prefix} → ${report.grade} (${report.score}/100, ${report.issues.length} issues) → ${file}`);
            } else {
              console.log(`${prefix} → ${report.grade} (${report.score}/100, ${report.issues.length} issues)`);
            }

            summary.push({
              name: repo.name,
              score: report.score,
              grade: report.grade,
              issues: report.issues.length,
            });
          } catch (err) {
            // One bad repo must not abort the whole batch.
            console.error(`${prefix} → FAILED: ${String(err)}`);
            summary.push({ name: repo.name, score: null, grade: "-", issues: 0, error: String(err) });
          }
        }

        const ok = summary.filter((s) => s.score !== null);
        const failed = summary.filter((s) => s.score === null);
        console.log(`\nDone: ${ok.length} scanned, ${failed.length} failed.`);
        if (ok.length > 0) {
          const avg = Math.round(ok.reduce((sum, s) => sum + (s.score ?? 0), 0) / ok.length);
          console.log(`Average score: ${avg}/100`);
        }

        if (options.outDir) {
          const indexFile = join(options.outDir, "summary.json");
          await fs.writeFile(indexFile, JSON.stringify(summary, null, 2), "utf-8");
          console.log(`Summary written to: ${indexFile}`);
        }
      } catch (err) {
        console.error("Error during batch scan:", err);
        process.exit(1);
      }
    });
}

async function main() {
  const program = new Command();

  program
    .name("repo-anti-rot")
    .description("CLI for Repo Anti-Rot repository health scanning")
    .version("0.0.0");

  registerScan(program);
  registerBatch(program);

  program.parse();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
