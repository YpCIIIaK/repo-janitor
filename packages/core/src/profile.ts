/**
 * Repo profiling helpers — classify source files by language and detect the
 * tooling/ecosystems a repository uses from characteristic manifest files.
 *
 * Pure and IO-free: the engine feeds in the file list (and per-file line counts
 * during its single read pass), these helpers turn it into the report `profile`.
 * Kept separate from the engine so the classification rules are unit-testable.
 */

/**
 * File extension → display language. Mirrors the engine's lines-of-code set
 * exactly, so a file counted toward LOC is always attributed to a language.
 */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  rb: "Ruby",
  php: "PHP",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  cs: "C#",
  kt: "Kotlin",
  swift: "Swift",
  scala: "Scala",
  vue: "Vue",
  svelte: "Svelte",
}

/** Display language for a path's extension, or null if it isn't a counted source file. */
export function extToLanguage(path: string): string | null {
  const m = path.replace(/\\/g, "/").toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!m) return null
  return EXTENSION_LANGUAGE[m[1]] ?? null
}

/** One ecosystem/tooling detection rule. */
interface ToolRule {
  tool: string
  test: RegExp
}

// Order is the display order; first match wins per tool. Tests run against the
// lower-cased, forward-slashed file list, anchored to a path segment boundary.
const TOOL_RULES: ToolRule[] = [
  { tool: "Node.js", test: /(^|\/)package\.json$/ },
  { tool: "pnpm", test: /(^|\/)pnpm-lock\.yaml$/ },
  { tool: "Yarn", test: /(^|\/)yarn\.lock$/ },
  { tool: "npm", test: /(^|\/)package-lock\.json$/ },
  { tool: "TypeScript", test: /(^|\/)tsconfig[^/]*\.json$/ },
  { tool: "Next.js", test: /(^|\/)next\.config\.[mc]?[jt]s$/ },
  { tool: "Vite", test: /(^|\/)vite\.config\.[mc]?[jt]s$/ },
  { tool: "Tailwind CSS", test: /(^|\/)tailwind\.config\.[mc]?[jt]s$/ },
  { tool: "Docker", test: /(^|\/)dockerfile$|\.dockerfile$/ },
  { tool: "Docker Compose", test: /(^|\/)(docker-)?compose\.ya?ml$/ },
  { tool: "GitHub Actions", test: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/ },
  { tool: "Go modules", test: /(^|\/)go\.mod$/ },
  { tool: "pip", test: /(^|\/)requirements[^/]*\.txt$/ },
  { tool: "Poetry", test: /(^|\/)pyproject\.toml$/ },
  { tool: "Cargo", test: /(^|\/)cargo\.toml$/ },
  { tool: "Bundler", test: /(^|\/)gemfile$/ },
  { tool: "Composer", test: /(^|\/)composer\.json$/ },
  { tool: "Maven", test: /(^|\/)pom\.xml$/ },
  { tool: "Gradle", test: /(^|\/)build\.gradle(\.kts)?$/ },
  { tool: "Make", test: /(^|\/)makefile$/ },
  { tool: "Vitest", test: /(^|\/)vitest\.config\.[mc]?[jt]s$/ },
  { tool: "Jest", test: /(^|\/)jest\.config\.[mc]?[jt]s$/ },
  { tool: "ESLint", test: /(^|\/)(\.eslintrc[^/]*|eslint\.config\.[mc]?[jt]s)$/ },
]

/**
 * Detect the ecosystems/tooling a repo uses from its file list, in a stable
 * display order. Case- and separator-insensitive.
 */
export function detectTools(files: string[]): string[] {
  const norm = files.map((f) => f.replace(/\\/g, "/").toLowerCase())
  const out: string[] = []
  for (const rule of TOOL_RULES) {
    if (norm.some((f) => rule.test.test(f))) out.push(rule.tool)
  }
  return out
}
