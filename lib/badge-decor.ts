/**
 * Decoration for the README badge: a smooth gradient and a few grey shapes
 * drifting behind the text.
 *
 * ## Three constraints shape every decision here
 *
 * 1. **No scripts.** GitHub proxies the image through camo and renders it in an
 *    `<img>`. Script inside an SVG never runs there, so the motion has to be
 *    declarative. CSS animation is used rather than SMIL because CSS can at
 *    least express `prefers-reduced-motion`.
 *
 *    That expression is not a guarantee, and the difference was measured rather
 *    than assumed. Open the badge URL directly and the media query works: the
 *    shapes park. Embed the same SVG in an `<img>` — which is the only way
 *    anyone sees it — and Chromium did not propagate the preference into the
 *    image document, so the animation kept running. The rule stays because it
 *    is correct and costs nothing if that changes, but it cannot be relied on,
 *    which is why the badge also takes an explicit `?motion=off`.
 *
 * 2. **Randomness happens once, at generation.** Camo caches the response, so a
 *    layout re-rolled per request would not reach the reader anyway. The seed is
 *    derived from `owner/name`: different repositories get visibly different
 *    arrangements — which is the point — while a single repository's badge stays
 *    the same image every time, instead of flickering between cached variants.
 *
 * 3. **The badge is twenty pixels tall.** Anything with real presence in that
 *    strip competes with the grade, which is the only thing the badge is for.
 *    The shapes are deliberately at the edge of visible: low opacity, no shape
 *    wider than a few pixels, and all of them behind the text.
 */

/** FNV-1a. Small, stable across platforms, and good enough to seed a PRNG. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a seeded PRNG so a given repository always renders identically. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DecorKind = "circle" | "square" | "slash"

export interface DecorShape {
  kind: DecorKind
  x: number
  y: number
  size: number
  opacity: number
  /** seconds for one drift cycle */
  duration: number
  /** negative, so shapes start mid-flight instead of in a row */
  delay: number
  /** horizontal travel in px, signed */
  travel: number
}

const KINDS: DecorKind[] = ["circle", "square", "slash"]

/** Round to 2dp — keeps the SVG small and the output stable to compare in tests. */
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Lay out the drifting shapes.
 *
 * Count scales with width so a short badge does not get as crowded as a long
 * one, and is capped: past a handful these stop reading as texture and start
 * reading as dirt on the screen.
 */
export function driftShapes(seed: number, width: number, height: number): DecorShape[] {
  const rand = makeRandom(seed)
  const count = Math.max(3, Math.min(7, Math.round(width / 22)))
  const out: DecorShape[] = []

  for (let i = 0; i < count; i++) {
    const duration = r2(7 + rand() * 11)
    out.push({
      kind: KINDS[Math.floor(rand() * KINDS.length)],
      // Spread across the width in bands, jittered, so they never clump.
      x: r2(((i + rand()) / count) * width),
      y: r2(2 + rand() * (height - 4)),
      // Tuned by looking at the badge at 1× rather than zoomed: the first pass
      // used half these values and was invisible at the size anyone actually
      // sees, which defeats the point of having texture at all.
      size: r2(1.8 + rand() * 2.6),
      opacity: r2(0.14 + rand() * 0.14),
      duration,
      delay: r2(-rand() * duration),
      travel: r2((rand() < 0.5 ? -1 : 1) * (4 + rand() * 7)),
    })
  }
  return out
}

function shapeBody(s: DecorShape, fill: string): string {
  switch (s.kind) {
    case "circle":
      return `<circle r="${s.size}" fill="${fill}"/>`
    case "square":
      return `<rect x="${r2(-s.size)}" y="${r2(-s.size)}" width="${r2(s.size * 2)}" height="${r2(s.size * 2)}" rx="0.5" fill="${fill}"/>`
    case "slash":
      // A short diagonal stroke — reads as a code-ish tick at this size.
      return `<path d="M${r2(-s.size)} ${r2(s.size)}L${r2(s.size)} ${r2(-s.size)}" stroke="${fill}" stroke-width="0.9" stroke-linecap="round" fill="none"/>`
  }
}

/**
 * The `<defs>` style block and the shape layer.
 *
 * Each shape gets its own keyframes because the travel distance differs; the
 * alternative — one shared animation plus per-shape scaling — costs more markup
 * than it saves. The reduced-motion block parks everything at its start
 * position: still decorative, no movement at all.
 */
export function decorLayer(shapes: DecorShape[], fill: string, animate = true): string {
  if (shapes.length === 0) return ""

  const nodesOf = () =>
    shapes
      .map(
        (s, i) =>
          `<g class="d${i}" transform="translate(${s.x} ${s.y})">${shapeBody(s, fill)}</g>`,
      )
      .join("")

  if (!animate) {
    // `?motion=off`: keep the texture, drop the movement. Parked shapes still
    // vary per repository, so the badge loses the animation and nothing else.
    const still = shapes.map((s, i) => `.d${i}{opacity:${s.opacity}}`).join("")
    return `<style>${still}</style><g>${nodesOf()}</g>`
  }

  const keyframes = shapes
    .map(
      (s, i) =>
        `@keyframes d${i}{0%{transform:translate(${s.x}px,${s.y}px)}50%{transform:translate(${r2(s.x + s.travel)}px,${r2(s.y + (i % 2 ? 1.2 : -1.2))}px)}100%{transform:translate(${s.x}px,${s.y}px)}}`,
    )
    .join("")

  const rules = shapes
    .map(
      (s, i) =>
        `.d${i}{animation:d${i} ${s.duration}s ${s.delay}s ease-in-out infinite;opacity:${s.opacity}}`,
    )
    .join("")

  const parked = shapes.map((_, i) => `.d${i}{animation:none}`).join("")

  return `<style>${keyframes}${rules}@media (prefers-reduced-motion:reduce){${parked}}</style><g>${nodesOf()}</g>`
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** Parse `#rgb` or `#rrggbb`. Returns null for anything else — callers fall back. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** Mix towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const c = parseHex(hex)
  if (!c) return hex
  const target = amount >= 0 ? 255 : 0
  const t = Math.abs(amount)
  const mix = (v: number) => clamp255(v + (target - v) * t)
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}
