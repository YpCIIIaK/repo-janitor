/**
 * Shields-style badge SVG, shared by every badge this app serves.
 *
 * Extracted when the second badge appeared. These images are rendered by
 * GitHub's camo proxy inside an `<img>`, which is a hostile little environment:
 * no scripts, no external references, no access to the page's CSS or the
 * reader's reduced-motion preference. Getting that right once and reusing it
 * beats getting it right twice.
 */

import { decorLayer, driftShapes, shade } from "@/lib/badge-decor"

/** Approximate Verdana width per char at 11px — good enough for badge spacing. */
export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[iIl.,:;'!|]/.test(ch) ? 3.5 : /[mwMW]/.test(ch) ? 9 : 6.5
  return Math.ceil(w)
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * A two-part badge: grey label on the left, coloured message on the right.
 *
 * `seed` picks the drifting decoration, so the same subject always gets the same
 * pattern; `animate` is the explicit opt-out a README author can paste, since
 * `prefers-reduced-motion` genuinely does not reach an SVG inside an `<img>`.
 */
export function badgeSvg(
  label: string,
  message: string,
  color: string,
  seed: number,
  animate: boolean,
): string {
  const pad = 6
  const lw = textWidth(label) + pad * 2
  const mw = textWidth(message) + pad * 2
  const total = lw + mw
  const h = 20
  const r = 3
  const lx = (lw / 2) * 10
  const mx = (lw + mw / 2) * 10
  const lLen = (lw - pad) * 10
  const mLen = (mw - pad) * 10

  // Diagonal gradients rather than flat fills: light to dark across each half.
  // The right-hand side is derived from the subject's colour, so a grade badge
  // keeps A green and F red — the gradient is decoration, never the thing being
  // read.
  const mLight = shade(color, 0.18)
  const mDark = shade(color, -0.16)

  const decor = decorLayer(driftShapes(seed, total, h), "#dfe6ee", animate)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <title>${esc(label)}: ${esc(message)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c636b"/><stop offset="1" stop-color="#41474e"/></linearGradient>
  <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mLight}"/><stop offset="1" stop-color="${mDark}"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="${h}" rx="${r}" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="${h}" fill="url(#lg)"/>
    <rect x="${lw}" width="${mw}" height="${h}" fill="url(#mg)"/>
    ${decor}
    <rect width="${total}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
    <text x="${lx}" y="140" transform="scale(.1)" textLength="${lLen}">${esc(label)}</text>
    <text aria-hidden="true" x="${mx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mLen}">${esc(message)}</text>
    <text x="${mx}" y="140" transform="scale(.1)" textLength="${mLen}">${esc(message)}</text>
  </g>
</svg>`
}
