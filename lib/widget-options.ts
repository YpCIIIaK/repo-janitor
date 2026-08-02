/**
 * Query-string options for badges, README cards and embed widgets.
 *
 * Options live in the URL so a pasted README snippet keeps looking the way the
 * publisher chose — no account, no second round-trip. Defaults omit from the
 * query so existing links stay short and identical.
 */

export type WidgetTheme = "dark" | "light"
export type BadgeStyle = "flat" | "flat-square"
export type BadgeMessage = "grade-score" | "grade" | "score"
export type EmbedSize = "compact" | "roomy"

export interface WidgetOptions {
  theme: WidgetTheme
  /** Severity chips (critical / warning / info). */
  chips: boolean
  /** Scope + scanned-at footer. */
  meta: boolean
  /** One-line verdict under the score (card / embed). */
  headline: boolean
  /** Shields left-hand label. */
  label: string
  style: BadgeStyle
  /** What the shields right-hand side shows. */
  message: BadgeMessage
  size: EmbedSize
}

export const DEFAULT_WIDGET_OPTIONS: WidgetOptions = {
  theme: "dark",
  chips: true,
  meta: true,
  headline: true,
  label: "repo anti-rot",
  style: "flat",
  message: "grade-score",
  size: "compact",
}

const STORAGE_KEY = "repo-anti-rot.widget-options:v1"

export function embedDimensions(size: EmbedSize): { width: number; height: number } {
  if (size === "roomy") return { width: 420, height: 268 }
  return { width: 420, height: 228 }
}

/** Default card height with all bands on — matches {@link CARD_HEIGHT} in health-card. */
export const DEFAULT_CARD_HEIGHT = 220

/** Card SVG height shrinks when optional bands are off. */
export function cardHeightFor(opts: Pick<WidgetOptions, "chips" | "meta" | "headline">): number {
  let h = DEFAULT_CARD_HEIGHT
  if (!opts.headline) h -= 22
  if (!opts.chips) h -= 40
  if (!opts.meta) h -= 28
  return Math.max(140, h)
}

export function parseWidgetOptions(input: URLSearchParams | string): WidgetOptions {
  const sp = typeof input === "string" ? new URLSearchParams(input) : input
  const theme = sp.get("theme") === "light" ? "light" : "dark"
  const style = sp.get("style") === "flat-square" ? "flat-square" : "flat"
  const rawMsg = sp.get("message")
  const message: BadgeMessage =
    rawMsg === "grade" || rawMsg === "score" ? rawMsg : "grade-score"
  const size = sp.get("size") === "roomy" ? "roomy" : "compact"
  const label = (sp.get("label") ?? DEFAULT_WIDGET_OPTIONS.label).trim().slice(0, 40) || DEFAULT_WIDGET_OPTIONS.label

  // `hide=chips,meta,headline` turns bands off. Absent → all on.
  const hide = new Set(
    (sp.get("hide") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )

  return {
    theme,
    chips: !hide.has("chips"),
    meta: !hide.has("meta"),
    headline: !hide.has("headline"),
    label,
    style,
    message,
    size,
  }
}

/** Only non-default keys — keeps README URLs short. Always includes token separately. */
export function widgetOptionsQuery(opts: WidgetOptions): URLSearchParams {
  const sp = new URLSearchParams()
  if (opts.theme !== DEFAULT_WIDGET_OPTIONS.theme) sp.set("theme", opts.theme)
  if (opts.style !== DEFAULT_WIDGET_OPTIONS.style) sp.set("style", opts.style)
  if (opts.message !== DEFAULT_WIDGET_OPTIONS.message) sp.set("message", opts.message)
  if (opts.size !== DEFAULT_WIDGET_OPTIONS.size) sp.set("size", opts.size)
  if (opts.label !== DEFAULT_WIDGET_OPTIONS.label) sp.set("label", opts.label)

  const hide: string[] = []
  if (!opts.chips) hide.push("chips")
  if (!opts.meta) hide.push("meta")
  if (!opts.headline) hide.push("headline")
  if (hide.length) sp.set("hide", hide.join(","))

  return sp
}

export function appendWidgetOptions(url: string, opts: WidgetOptions): string {
  const q = widgetOptionsQuery(opts)
  if (![...q.keys()].length) return url
  const join = url.includes("?") ? "&" : "?"
  return `${url}${join}${q.toString()}`
}

export function loadWidgetOptions(): WidgetOptions {
  if (typeof window === "undefined") return { ...DEFAULT_WIDGET_OPTIONS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_WIDGET_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<WidgetOptions>
    return { ...DEFAULT_WIDGET_OPTIONS, ...parsed }
  } catch {
    return { ...DEFAULT_WIDGET_OPTIONS }
  }
}

export function saveWidgetOptions(opts: WidgetOptions): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts))
  } catch {
    /* quota / private mode */
  }
}

export function formatBadgeMessage(
  grade: string,
  score: number,
  message: BadgeMessage,
): string {
  if (message === "grade") return grade
  if (message === "score") return String(score)
  return `${grade} ${score}`
}
