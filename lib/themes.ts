/**
 * Named colour themes for the dashboard.
 *
 * All themes are dark — there is no light palette. next-themes writes the id
 * onto `<html data-theme="…">`; the `dark` class stays permanent for `dark:`
 * utilities (multi-token class values are invalid for DOMTokenList).
 */

export const THEME_IDS = ["moss", "ocean", "aurora"] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME: ThemeId = "moss"

export type ThemeMeta = {
  id: ThemeId
  /** Stable English label for the English-only dashboard. */
  label: string
  /** Short blurb shown in Settings. */
  description: string
  /** Preview swatches: background, surface, accent. */
  swatches: [string, string, string]
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "moss",
    label: "Moss",
    description: "Cool charcoal with a soft green accent.",
    swatches: ["#242428", "#333338", "#5db88a"],
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep blue-grey with a muted azure accent.",
    swatches: ["#1e2430", "#2a3344", "#6b8fc4"],
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Teal-tinted dusk — green and blue mixed quietly.",
    swatches: ["#1c2626", "#283434", "#5fa8a0"],
  },
] as const

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value)
}
