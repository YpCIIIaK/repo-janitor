import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const fixture = JSON.parse(await readFile("lib/demo-fixture.json", "utf8"));
// Fixture revision time, deliberately stable so regeneration is reproducible.
const generatedAt = "2026-09-07T00:00:00.000Z";
const workspace = await mkdtemp(join(tmpdir(), "rar-demo-"));
try {
  const reports = {};
  for (const phase of ["before", "after"]) {
    const root = join(workspace, phase);
    for (const [name, text] of Object.entries({ ...fixture.common, ...fixture[phase] })) {
      const target = resolve(root, name);
      const rel = relative(root, target);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid fixture path");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    const run = spawnSync(process.execPath, [resolve("packages/cli/dist/index.js"), "scan", root, "--only", fixture.scanners.join(","), "--format", "json"], { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`Demo scan failed: ${run.stderr}`);
    reports[phase] = JSON.parse(run.stdout);
    // Stable educational identity; the report came from the fixture, not GitHub.
    reports[phase].repo = { owner: "demo", name: "cart-example", defaultBranch: "main" };
    reports[phase].generatedAt = generatedAt;
  }
  await writeFile("lib/demo-report.json", JSON.stringify({ generatedAt, scanners: fixture.scanners, ...reports }, null, 2) + "\n");
  console.info("Generated demo from two real fixture scans.");
} finally {
  if (resolve(workspace).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))) await rm(workspace, { recursive: true, force: true });
}
