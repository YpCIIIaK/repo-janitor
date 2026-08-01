import type { Grade } from "@/lib/mock-data"
import { UNKNOWN_GRADE_HEX, gradeHex } from "@/lib/grade-style"
import { isBoastworthy, verdictOf, type VerdictCounts } from "@/lib/verdict"

/**
 * Large README health card — the “star counter” size, not the shields strip.
 *
 * GitHub READMEs cannot host iframes, so this is an SVG image: same distribution
 * channel as the small badge, enough room for grade, score, severity and a
 * one-line verdict. Pure so the layout can be unit-tested without a server.
 */

export const CARD_WIDTH = 480
/** Tall enough for chips + footer without the meta line sitting on the badges. */
export const CARD_HEIGHT = 220

const UNKNOWN_COLOR = UNKNOWN_GRADE_HEX

/** Left padding / content start. */
const PAD_X = 28
/** Vertical gap reserved under severity chips for the meta footer. */
const FOOTER_BAND = 36

export type HealthCardData = {
  owner: string
  name: string
  grade: Grade
  score: number
  counts: VerdictCounts
  totalIssues: number
  /** ISO timestamp of the scan, when known. */
  generatedAt?: string
  /** "1,240 files · 182,431 lines" — only when the scan recorded a profile. */
  scope?: string | null
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Truncate for the title row so a long org name cannot shove the grade off. */
export function truncateLabel(s: string, max = 36): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(1, max - 1))}…`
}

/** Compact "43591" → "44k" so the meta line fits beside the grade plaque. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

/**
 * Shorten a scopeLine() string ("1,240 files · 182,431 lines") for tight plaques.
 */
export function compactScope(scope: string | null | undefined): string | null {
  if (!scope) return null
  // "385 files · 43,591 lines" → "385 files · 44k lines"
  return scope.replace(/(\d{1,3}(?:,\d{3})+|\d{4,})/g, (raw) => {
    const n = Number(raw.replace(/,/g, ""))
    return Number.isFinite(n) ? compactCount(n) : raw
  })
}

export function formatScannedAt(iso: string | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  // Fixed UTC so a badge rendered in Tokyo and one rendered in London agree.
  return new Date(t).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/**
 * One-line meta for card/embed footers. Keeps chips readable by staying short.
 */
export function formatCardFoot(
  scope: string | null | undefined,
  generatedAt: string | undefined,
  maxLen = 48,
): string {
  const parts = [
    compactScope(scope),
    (() => {
      const d = formatScannedAt(generatedAt)
      return d ? `Scanned ${d}` : null
    })(),
  ].filter(Boolean) as string[]
  if (parts.length === 0) return "Snapshot of a published scan"
  return truncateLabel(parts.join(" · "), maxLen)
}

export function cardHeadline(data: Pick<HealthCardData, "counts" | "totalIssues" | "score">): string {
  const verdict = verdictOf(data.counts, data.totalIssues, data.score)
  if (verdict === "clean") return "Clean scan — nothing found"
  if (isBoastworthy(verdict)) return "No critical or warning findings"
  if (data.totalIssues === 1) return "1 finding"
  return `${data.totalIssues} findings`
}

/**
 * Build the SVG for a known report, or a neutral unknown card when `data` is null.
 *
 * `pathOwner` / `pathName` are always taken from the URL so a mismatched token
 * cannot put someone else's grade under this repository's name.
 */
export function renderHealthCardSvg(
  pathOwner: string,
  pathName: string,
  data: HealthCardData | null,
): string {
  const w = CARD_WIDTH
  const h = CARD_HEIGHT
  const title = truncateLabel(`${pathOwner}/${pathName}`)
  const aria = data
    ? `Repo Anti-Rot: ${pathOwner}/${pathName} grade ${data.grade}, ${data.score} of 100`
    : `Repo Anti-Rot: ${pathOwner}/${pathName} unknown`

  if (!data) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">
  <title>${esc(aria)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="12" fill="url(#bg)" stroke="#30363d" stroke-width="1"/>
  <text x="${PAD_X}" y="40" fill="#8b949e" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="600">Repo Anti-Rot</text>
  <text x="${PAD_X}" y="78" fill="#e6edf3" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="22" font-weight="700">${esc(title)}</text>
  <text x="${PAD_X}" y="120" fill="${UNKNOWN_COLOR}" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="28" font-weight="700">unknown</text>
  <text x="${PAD_X}" y="${h - 22}" fill="#6e7681" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="12">No published scan for this repository</text>
</svg>`
  }

  const color = gradeHex(data.grade)
  const headline = cardHeadline(data)
  const boast = isBoastworthy(verdictOf(data.counts, data.totalIssues, data.score))
  const { critical, warning, info } = data.counts
  const foot = formatCardFoot(data.scope, data.generatedAt, 52)

  // Severity chips — muted when zero so a clean result does not look alarmed.
  const chip = (label: string, n: number, fill: string, x: number) => {
    const active = n > 0
    const bg = active ? fill : "#21262d"
    const fg = active ? "#0d1117" : "#6e7681"
    const text = `${n} ${label}`
    const cw = Math.max(64, 18 + text.length * 6.4)
    return `
    <g transform="translate(${x},0)">
      <rect width="${cw}" height="26" rx="13" fill="${bg}"/>
      <text x="${cw / 2}" y="17" text-anchor="middle" fill="${fg}" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="11" font-weight="600">${esc(text)}</text>
    </g>`
  }

  let chipX = 0
  const chips: string[] = []
  for (const [label, n, fill] of [
    ["critical", critical, "#f85149"],
    ["warning", warning, "#d29922"],
    ["info", info, "#8b949e"],
  ] as const) {
    const text = `${n} ${label}`
    const cw = Math.max(64, 18 + text.length * 6.4)
    chips.push(chip(label, n, fill, chipX))
    chipX += cw + 8
  }

  // Layout bands (top → bottom): brand, title, score/headline, chips, footer.
  // Chips sit above a dedicated footer band so the meta line cannot cover them.
  const chipY = h - FOOTER_BAND - 26 - 10
  const footY = h - 18

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">
  <title>${esc(aria)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="12" fill="url(#bg)" stroke="#30363d" stroke-width="1"/>
  <rect x="0" y="0" width="6" height="${h}" rx="3" fill="${color}"/>
  <rect x="6" y="0" width="160" height="${h}" fill="url(#glow)"/>

  <text x="${PAD_X}" y="34" fill="#8b949e" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="12" font-weight="600" letter-spacing="0.04em">REPO ANTI-ROT</text>
  <text x="${PAD_X}" y="62" fill="#e6edf3" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="20" font-weight="700">${esc(title)}</text>

  <!-- Grade plaque — stops above the chip row -->
  <rect x="${w - 124}" y="24" width="92" height="92" rx="16" fill="#0d1117" stroke="${color}" stroke-width="3"/>
  <text x="${w - 78}" y="88" text-anchor="middle" fill="${color}" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="52" font-weight="800">${esc(data.grade)}</text>

  <text x="${PAD_X}" y="102" fill="#e6edf3" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="28" font-weight="700">${data.score}<tspan fill="#8b949e" font-size="16" font-weight="600">/100</tspan></text>
  <text x="${PAD_X}" y="126" fill="${boast ? color : "#c9d1d9"}" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="600">${esc(headline)}</text>

  <g transform="translate(${PAD_X},${chipY})">${chips.join("")}</g>

  <text x="${PAD_X}" y="${footY}" fill="#6e7681" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="11">${esc(foot)}</text>
</svg>`
}
