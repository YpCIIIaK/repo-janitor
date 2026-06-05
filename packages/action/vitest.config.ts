import { defineConfig } from "vitest/config"

/**
 * Vitest config for the GitHub Action. Tests cover the pure helpers in lib.ts
 * (input parsing, fail-on threshold, PR-comment rendering, ingest endpoint); the
 * network/IO orchestration in index.ts is validated by end-to-end runs.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
