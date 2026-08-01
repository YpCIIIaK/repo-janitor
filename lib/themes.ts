/**
 * Named colour themes for the dashboard.
 *
 * next-themes writes the id onto `<html data-theme="…">`. Light vs dark is a
 * separate concern: the `dark` class is toggled for Tailwind `dark:` utilities
 * (a multi-token class value is invalid for DOMTokenList, so it cannot ride
 * along in the theme attribute).
 */

export const THEME_IDS = [
  "moss",
  "ocean",
  "aurora",
  "ember",
  "plum",
  "rose",
  "paper",
  "chalk",
] as const
export type ThemeId = (typeof THEME_IDS)[number]
export type ThemeMode = "light" | "dark"

export const DEFAULT_THEME: ThemeId = "moss"

export type ThemeMeta = {
  id: ThemeId
  mode: ThemeMode
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
    mode: "dark",
    label: "Moss",
    description: "Cool charcoal with a soft green accent.",
    swatches: ["#242428", "#333338", "#5db88a"],
  },
  {
    id: "ocean",
    mode: "dark",
    label: "Ocean",
    description: "Deep blue-grey with a muted azure accent.",
    swatches: ["#1e2430", "#2a3344", "#6b8fc4"],
  },
  {
    id: "aurora",
    mode: "dark",
    label: "Aurora",
    description: "Teal-tinted dusk — green and blue mixed quietly.",
    swatches: ["#1c2626", "#283434", "#5fa8a0"],
  },
  {
    id: "ember",
    mode: "dark",
    label: "Ember",
    description: "Warm charcoal with a soft amber accent.",
    swatches: ["#2a221c", "#3a3028", "#c4a06a"],
  },
  {
    id: "plum",
    mode: "dark",
    label: "Plum",
    description: "Muted violet dusk with a soft lilac accent.",
    swatches: ["#221e28", "#322c3a", "#a890c4"],
  },
  {
    id: "rose",
    mode: "dark",
    label: "Rose",
    description: "Dusty rose night with a quiet coral accent.",
    swatches: ["#261e20", "#362a2e", "#c49090"],
  },
  {
    id: "paper",
    mode: "light",
    label: "Paper",
    description: "Warm off-white with a calm green accent.",
    swatches: ["#f6f4ef", "#ebe7df", "#3d8f6a"],
  },
  {
    id: "chalk",
    mode: "light",
    label: "Chalk",
    description: "Cool light grey with a muted blue accent.",
    swatches: ["#f3f5f8", "#e4e9f0", "#4a6fa5"],
  },
] as const

export const DARK_THEMES = THEMES.filter((t) => t.mode === "dark")
export const LIGHT_THEMES = THEMES.filter((t) => t.mode === "light")

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value)
}

export function themeMode(id: ThemeId): ThemeMode {
  return THEMES.find((t) => t.id === id)?.mode ?? "dark"
}

export function isDarkTheme(id: unknown): boolean {
  return isThemeId(id) ? themeMode(id) === "dark" : true
}

/**
 * Inline script: apply stored theme + `dark` class before first paint.
 *
 * The wrapping is `(function(){…})()`, not `(!function(){…})()`. The latter
 * parses fine and throws at run time — it negates the function to `false` and
 * then calls the boolean — so the whole script died on the first statement, the
 * `catch` inside it never ran, and every page loaded with no `data-theme` until
 * React hydrated. The symptom was a theme flash on load, and a TypeError in the
 * console that looked like it belonged to a framework chunk.
 */
export function themeInitScript(): string {
  const darkIds = DARK_THEMES.map((t) => t.id)
  return `(function(){try{var d=document.documentElement;var t=localStorage.getItem("theme");var dark=${JSON.stringify(darkIds)};var all=${JSON.stringify([...THEME_IDS])};if(!t||all.indexOf(t)===-1)t=${JSON.stringify(DEFAULT_THEME)};d.setAttribute("data-theme",t);d.classList.toggle("dark",dark.indexOf(t)!==-1);}catch(e){document.documentElement.classList.add("dark");document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}})();`
}
