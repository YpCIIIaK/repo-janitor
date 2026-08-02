/**
 * Query-string options for badges, README cards and embed widgets.
 *
 * There is exactly one: `?theme=light`. It lives in the URL so a pasted README
 * snippet keeps looking the way the publisher chose, and it is omitted when it
 * is the default so existing links stay short.
 *
 * ## Why only one
 *
 * This used to carry seven — `hide=chips,meta,headline`, `message`, `style`,
 * `label`, `size` — plus a panel in the Share dialog to drive them and a
 * localStorage key to remember them. It was a lot of surface for a picture, and
 * the settings competed for attention with the thing being shared: someone who
 * had just scanned their repository was handed a form instead of a snippet.
 *
 * Theme survives because it is the one choice the publisher cannot make for the
 * reader and the reader cannot make for themselves: a dark card in a light
 * README is a black rectangle on the page, and no default gets that right for
 * everyone. The rest were preferences about our own layout, and a card that has
 * one good layout does not need a control for it.
 */

export type WidgetTheme = "dark" | "light"

export interface WidgetOptions {
  theme: WidgetTheme
}

export const DEFAULT_WIDGET_OPTIONS: WidgetOptions = {
  theme: "dark",
}

/** Embed iframe size. One shape, since the bands it used to vary are fixed. */
export function embedDimensions(): { width: number; height: number } {
  return { width: 420, height: 228 }
}

/** Card SVG height. Constant — the optional bands that used to shrink it are gone. */
export const DEFAULT_CARD_HEIGHT = 220

export function parseWidgetOptions(input: URLSearchParams | string): WidgetOptions {
  const sp = typeof input === "string" ? new URLSearchParams(input) : input
  return { theme: sp.get("theme") === "light" ? "light" : "dark" }
}

/** Only non-default keys — keeps README URLs short. Token is appended separately. */
export function widgetOptionsQuery(opts: WidgetOptions): URLSearchParams {
  const sp = new URLSearchParams()
  if (opts.theme !== DEFAULT_WIDGET_OPTIONS.theme) sp.set("theme", opts.theme)
  return sp
}

export function appendWidgetOptions(url: string, opts: WidgetOptions): string {
  const q = widgetOptionsQuery(opts)
  if (![...q.keys()].length) return url
  const join = url.includes("?") ? "&" : "?"
  return `${url}${join}${q.toString()}`
}

/** The shields right-hand side: always grade and score. */
export function formatBadgeMessage(grade: string, score: number): string {
  return `${grade} ${score}`
}
