import { defineConfig } from "tsup"
import { createRequire } from "module"

const { version } = createRequire(import.meta.url)("./package.json") as { version: string }

export default defineConfig({
  // index → the `repo-anti-rot` bin; context → the `repo-anti-rot/context`
  // subpath the GitHub Action bundles (the Node ScanContext impl).
  entry: ["src/index.ts", "src/context.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Bundle the workspace core in: it ships raw .ts (main → src/index.ts),
  // so leaving it external makes Node fail with ERR_UNKNOWN_FILE_EXTENSION.
  // Everything else (commander/fast-glob/simple-git/zod) stays a real dep.
  noExternal: ["@repo-anti-rot/core"],
  // Stamp the CLI's --version from package.json at build time.
  define: { __CLI_VERSION__: JSON.stringify(version) },
  // Wipe dist first. Without this, tsup leaves every previous build's
  // content-hashed chunk behind and `files: ["dist"]` publishes the lot: the
  // 0.2.0 tarball was 26 files and 13 MB unpacked, of which fifteen were dead
  // copies of the engine from earlier builds. Nothing imports them, so nothing
  // ever failed — the package just quietly grew by a megabyte per release,
  // which is precisely the kind of decay this tool reports on.
  clean: true,
})
