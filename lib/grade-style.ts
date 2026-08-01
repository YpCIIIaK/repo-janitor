import type { Grade } from "@/lib/mock-data"

/**
 * Single source of truth for grade colours across the dashboard, shared report,
 * badges and cards.
 *
 * Scale (best → worst): green → yellow-green → amber → orange → red.
 * B and C must never share a colour — that collapses the middle of the scale.
 */

export const GRADE_LABEL: Record<Grade, string> = {
  A: "Pristine",
  B: "Healthy",
  C: "Aging",
  D: "Rotting",
  F: "Critical decay",
}

/** CSS custom properties for gauges, sparklines and inline styles. */
export const GRADE_CSS_VAR: Record<Grade, string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  F: "var(--grade-f)",
}

/**
 * Tailwind badge classes (`text-*` / `border-*` / `bg-*`).
 * Requires `--color-grade-*` in `app/globals.css`.
 */
export const GRADE_BADGE_CLASS: Record<Grade, string> = {
  A: "text-grade-a border-grade-a/30 bg-grade-a/10",
  B: "text-grade-b border-grade-b/30 bg-grade-b/10",
  C: "text-grade-c border-grade-c/30 bg-grade-c/10",
  D: "text-grade-d border-grade-d/30 bg-grade-d/10",
  F: "text-grade-f border-grade-f/30 bg-grade-f/10",
}

/**
 * Fixed hex for SVG badges / README cards.
 * Those images are rendered without the page's CSS variables (GitHub `<img>`).
 */
export const GRADE_HEX: Record<Grade, string> = {
  A: "#3fb950",
  B: "#8bc96f",
  C: "#d29922",
  D: "#db6d28",
  F: "#f85149",
}

export const UNKNOWN_GRADE_HEX = "#8b949e"

export function gradeBadgeClass(grade: string | undefined | null): string {
  if (grade && grade in GRADE_BADGE_CLASS) {
    return GRADE_BADGE_CLASS[grade as Grade]
  }
  return GRADE_BADGE_CLASS.F
}

export function gradeCssVar(grade: string | undefined | null): string {
  if (grade && grade in GRADE_CSS_VAR) {
    return GRADE_CSS_VAR[grade as Grade]
  }
  return "var(--muted-foreground)"
}

export function gradeHex(grade: string | undefined | null): string {
  if (grade && grade in GRADE_HEX) {
    return GRADE_HEX[grade as Grade]
  }
  return UNKNOWN_GRADE_HEX
}
