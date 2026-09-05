import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScanContext } from "../src/context";

it("never reads a path outside the scanned repository or oversized files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rar-boundary-"));
  try {
    const root = join(dir, "repo");
    await mkdir(root);
    await writeFile(join(dir, "secret.txt"), "server secret");
    const outside = join(dir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "credential.txt"), "outside secret");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(root, "ok.txt"), "source");
    await writeFile(join(root, "huge.txt"), Buffer.alloc(2 * 1024 * 1024 + 1));
    const ctx = await buildScanContext(root);
    expect(await ctx.readFile("ok.txt")).toBe("source");
    expect(await ctx.readFile("../secret.txt")).toBeNull();
    expect(await ctx.readFile(join(dir, "secret.txt"))).toBeNull();
    expect(await ctx.readFile("huge.txt")).toBeNull();
    expect(await ctx.readFile("linked/credential.txt")).toBeNull();
    expect(ctx.files).not.toContain("linked/credential.txt");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
