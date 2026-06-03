import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  // CJS, not ESM: bundled deps (fast-glob, simple-git) are CommonJS and require()
  // node builtins, which an ESM bundle can't shim. CJS runs them natively.
  format: ["cjs"],
  splitting: false,
  platform: "node",
  target: "node20",
  // A GitHub Action runs `node dist/index.js` with no node_modules on the runner,
  // so everything (workspace packages + simple-git/fast-glob/babel/zod) must be
  // bundled into a single self-contained file. dist/ is committed for releases.
  noExternal: [/.*/],
})
