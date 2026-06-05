import { defineConfig } from "vitest/config"

/**
 * Vitest config for the CLI package. Tests cover the pure helpers (repo-metadata
 * parsing, report filenames); the IO-heavy scan pipeline is exercised via the
 * engine's own suite and end-to-end runs.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
