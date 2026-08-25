import fs from "node:fs";
import path from "node:path";

import { workspaceRoot } from "@/lib/paths";

export function webRoot() {
  const dir = path.join(workspaceRoot(), "data", "web");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function webTargetsPath() {
  return path.join(webRoot(), "targets.json");
}

export function webSiteDir(slug: string) {
  const dir = path.join(webRoot(), "sites", slug.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40) || "site");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function webFindingsPath() {
  return path.join(webRoot(), "findings.json");
}
