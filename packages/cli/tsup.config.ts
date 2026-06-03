import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Bundle the workspace core in: it ships raw .ts (main → src/index.ts),
  // so leaving it external makes Node fail with ERR_UNKNOWN_FILE_EXTENSION.
  noExternal: ["@repo-anti-rot/core"],
})
