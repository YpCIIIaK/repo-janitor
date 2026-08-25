import fs from "node:fs";
import path from "node:path";

/** Repo root (parent of workbench/). Overridable via WORKSPACE_ROOT. */
export function workspaceRoot(): string {
  if (process.env.WORKSPACE_ROOT) return path.resolve(process.env.WORKSPACE_ROOT);
  return path.resolve(process.cwd(), "..");
}

export function workbenchRoot(): string {
  return path.resolve(process.cwd());
}

export function dbPath(): string {
  const dir = path.join(workbenchRoot(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "workbench.db");
}

export function bountyRoot(): string {
  return path.join(workspaceRoot(), "data", "bounty");
}

export function auditsRoot(): string {
  return path.join(workspaceRoot(), "data", "audits");
}
