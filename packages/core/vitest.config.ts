import { defineConfig } from "vitest/config"

/**
 * Vitest config for the scanning engine.
 *
 * Tests live under `test/` and exercise the pure scanners through an in-memory
 * `ScanContext` (see test/helpers.ts) — no real filesystem, git, or network, so
 * they are fast and deterministic. Run with `pnpm --filter @repo-anti-rot/core test`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
