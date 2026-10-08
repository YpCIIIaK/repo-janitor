/**
 * Presentation helpers for the repo profile (the "About" tab).
 *
 * The engine ships a language breakdown (files + non-blank lines per language)
 * and a list of detected tooling. Here we turn the raw language list into display
 * shares — top-N languages plus a collapsed "Other" bucket — so the bar stays
 * readable and never shows a long tail.
 */

export interface ProfileLanguage {
  language: string
  files: number
  loc: number
}

export interface RepoProfile {
  totalFiles: number
  languages: ProfileLanguage[]
  tools: string[]
  checklist?: Record<string, boolean>
  activity?: {
    lastCommitAt?: string
    commitsLastYear: number
    months: { month: string; commits: number }[]
    authors: number
    coreAuthors: number
  }
}

/** What the scan actually checks for each detected tool — the About tab's captions. */
export const TOOL_CHECKS: Record<string, string> = {
  "Node.js": "Known CVEs (OSV), outdated and abandoned packages, end-of-life Node, unused exports, env vars missing from .env.example",
  pnpm: "Lockfile drift; a second package manager's lockfile left behind",
  Yarn: "Lockfile drift; a second package manager's lockfile left behind",
  npm: "Lockfile drift; a second package manager's lockfile left behind",
  TypeScript: "Unused exports, leftover debugger/console calls, insecure patterns",
  Docker: "Unpinned base images, running as root, ADD of remote URLs",
  "GitHub Actions": "Workflow injection and secret exposure, tests not run in CI, end-of-life runner images",
  "Go modules": "Known CVEs in Go modules (OSV)",
  pip: "Known CVEs (OSV), end-of-life Python",
  Poetry: "Known CVEs (OSV), end-of-life Python",
  Cargo: "Known CVEs in crates (OSV)",
  Bundler: "Known CVEs in gems (OSV)",
  Composer: "Known CVEs in PHP packages (OSV)",
  Vitest: "Skipped and focused (.only) tests",
  Jest: "Skipped and focused (.only) tests",
  ESLint: "Duplicate configs where one is silently ignored",
}

export const CHECKLIST_LABELS: Record<string, { label: string; why: string }> = {
  readme: { label: "README", why: "What the project is and how to start" },
  license: { label: "License", why: "Without one, nobody may legally reuse the code" },
  contributing: { label: "Contributing guide", why: "How to send a change" },
  security: { label: "Security policy", why: "Where to report a vulnerability privately" },
  codeOfConduct: { label: "Code of conduct", why: "Expectations for contributors" },
  changelog: { label: "Changelog", why: "What changed between versions" },
  ci: { label: "CI pipeline", why: "Every change is built and checked automatically" },
  tests: { label: "Tests", why: "Changes can be verified, not just hoped for" },
  gitignore: { label: ".gitignore", why: "Build output and secrets stay out of git" },
}

export interface LanguageShare extends ProfileLanguage {
  /** Percentage of the repo this language represents (0–100). */
  share: number
}

/**
 * Rank languages and compute their shares. Shares are by lines of code; if no
 * file could be read (all LOC zero) it falls back to file counts so the bar still
 * renders. Anything past `topN` is merged into a single "Other" entry.
 */
export function languageShares(
  languages: ProfileLanguage[],
  topN = 6,
): { shares: LanguageShare[]; totalLoc: number } {
  const totalLoc = languages.reduce((sum, l) => sum + l.loc, 0)
  const useLoc = totalLoc > 0
  const metric = (l: ProfileLanguage) => (useLoc ? l.loc : l.files)
  const denom = languages.reduce((sum, l) => sum + metric(l), 0) || 1

  const sorted = [...languages].sort((a, b) => metric(b) - metric(a) || a.language.localeCompare(b.language))
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)

  const shares: LanguageShare[] = top.map((l) => ({ ...l, share: (metric(l) / denom) * 100 }))

  if (rest.length > 0) {
    const files = rest.reduce((s, l) => s + l.files, 0)
    const loc = rest.reduce((s, l) => s + l.loc, 0)
    shares.push({ language: "Other", files, loc, share: ((useLoc ? loc : files) / denom) * 100 })
  }

  return { shares, totalLoc }
}
