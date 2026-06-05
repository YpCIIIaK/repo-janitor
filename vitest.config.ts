import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import path from "node:path"

/**
 * Vitest config for the dashboard (Next.js root package).
 *
 * Tests live in `test/` and cover the pure `lib/*` modules — scoring, age/hotspot
 * analysis, search, report export, scheduling, GitHub links, store math. They run
 * in Node with the same `@/` path alias the app uses; no jsdom or Next runtime is
 * needed because these modules are pure. (Server-only modules and React hooks are
 * out of scope here.)
 */
const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
})
