import js from "@eslint/js"
import tseslint from "typescript-eslint"
import next from "eslint-config-next"

/**
 * Flat config for the whole monorepo. Two zones:
 *  - the Next.js dashboard (app/, components/, lib/, hooks/) gets the Next preset
 *    (react-hooks, jsx-a11y, core-web-vitals).
 *  - the engine/CLI/action packages are plain Node TypeScript — JS + TS recommended only.
 *
 * Type-checked rules are intentionally off: they need a per-package project graph
 * and slow lint down a lot. `tsc --noEmit` (already in CI) covers type safety.
 */
const dashboardFiles = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "hooks/**/*.{ts,tsx}",
]

// Reuse the react/react-hooks plugin instances the Next preset already registers,
// so we can tune their rules without depending on the plugins resolving at the repo
// root (they aren't hoisted under pnpm's strict node_modules layout).
const nextReactPlugins = Object.fromEntries(
  Object.entries(next.find((c) => c.plugins?.["react-hooks"])?.plugins ?? {}).filter(
    ([name]) => name === "react" || name === "react-hooks",
  ),
)

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".next/**",
      "packages/*/dist/**",
      "datamine/**",
      "sample-repo/**",
      "reports/**",
      ".repo-anti-rot/**",
      "**/*.tsbuildinfo",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Next.js preset only for the dashboard sources.
  ...next.map((cfg) => ({
    ...cfg,
    files: dashboardFiles,
  })),
  // Global overrides (core rules + typescript-eslint — plugins always in scope).
  // These categories were driven to zero in the lint-adoption pass, so they're
  // enforced as errors now — a regression fails CI.
  {
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`. Kept at "warn"
      // since half-finished code routinely trips it during development.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-useless-escape": "error",
    },
  },
  // Dashboard-only react overrides. The react/react-hooks plugins live in the Next
  // preset, so these rules must be configured in a block that carries that plugin —
  // we reuse the plugin instances the preset already registered. The react-hooks v6
  // rules are enforced; the few legitimate exceptions carry inline disable comments.
  {
    files: dashboardFiles,
    plugins: nextReactPlugins,
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/purity": "error",
      // Cosmetic-only; apostrophes in prose read fine.
      "react/no-unescaped-entities": "off",
    },
  },
  // Vendored shadcn/ui primitives — we don't fork upstream to satisfy lint, so the
  // strict react-hooks RC rules and `any` in their generic prop plumbing are off here.
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    plugins: nextReactPlugins,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
)
