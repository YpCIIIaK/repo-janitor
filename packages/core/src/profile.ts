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

/** Community-standard files a maintained project usually carries. */
export const CHECKLIST_ITEMS = [
  "readme",
  "license",
  "contributing",
  "security",
  "codeOfConduct",
  "changelog",
  "ci",
  "tests",
  "gitignore",
] as const
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number]

const CHECKLIST_RULES: Record<ChecklistItem, RegExp> = {
  readme: /^(\.github\/|docs\/)?readme(\.[a-z]+)?$/,
  license: /^(licen[cs]e|copying)(\.[a-z]+)?$/,
  contributing: /^(\.github\/|docs\/)?contributing(\.[a-z]+)?$/,
  security: /^(\.github\/|docs\/)?security(\.[a-z]+)?$/,
  codeOfConduct: /^(\.github\/|docs\/)?code_of_conduct(\.[a-z]+)?$/,
  changelog: /^(changelog|changes|history)(\.[a-z]+)?$/,
  ci: /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml|jenkinsfile|\.travis\.ya?ml)$/,
  tests: /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.go$/,
  gitignore: /^\.gitignore$/,
}

/** Which community-standard files are present, from the file list alone. */
export function detectChecklist(files: string[]): Record<ChecklistItem, boolean> {
  const norm = files.map((f) => f.replace(/\\/g, "/").toLowerCase())
  const out = {} as Record<ChecklistItem, boolean>
  for (const item of CHECKLIST_ITEMS) out[item] = norm.some((f) => CHECKLIST_RULES[item].test(f))
  return out
}

/** One commit as the activity summary needs it: an opaque author key and a time. */
export interface ActivityCommit {
  author: string
  at: number
}

/**
 * Commit activity over the last 12 months. Author identities never leave this
 * function: the report carries counts only.
 */
export function summarizeActivity(
  commits: ActivityCommit[],
  lastCommitAt: number | null,
  now = Date.now(),
): {
  lastCommitAt?: string
  commitsLastYear: number
  months: { month: string; commits: number }[]
  authors: number
  coreAuthors: number
} {
  const start = new Date(now)
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCMonth(start.getUTCMonth() - 11)
  const months: { month: string; commits: number }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(start)
    d.setUTCMonth(start.getUTCMonth() + i)
    months.push({ month: d.toISOString().slice(0, 7), commits: 0 })
  }
  const index = new Map(months.map((m, i) => [m.month, i]))
  const perAuthor = new Map<string, number>()
  let total = 0
  for (const c of commits) {
    if (c.at < start.getTime() || c.at > now) continue
    const i = index.get(new Date(c.at).toISOString().slice(0, 7))
    if (i === undefined) continue
    months[i].commits++
    total++
    perAuthor.set(c.author, (perAuthor.get(c.author) ?? 0) + 1)
  }
  // Fewest authors that together made 80% of the year's commits.
  const counts = [...perAuthor.values()].sort((a, b) => b - a)
  let core = 0
  let acc = 0
  for (const n of counts) {
    if (acc >= total * 0.8) break
    acc += n
    core++
  }
  return {
    lastCommitAt: lastCommitAt ? new Date(lastCommitAt).toISOString() : undefined,
    commitsLastYear: total,
    months,
    authors: perAuthor.size,
    coreAuthors: core,
  }
}
