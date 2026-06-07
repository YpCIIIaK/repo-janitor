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
