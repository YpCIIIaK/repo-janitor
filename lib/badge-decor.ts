/**
 * Decoration shared by the README badge and the large health card: grey shapes
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
 * 3. **Scale decides the numbers, so both surfaces get their own.** The badge is
 *    twenty pixels tall: anything with real presence there competes with the
 *    grade, which is the only thing a badge is for, so its shapes sit at the
 *    edge of visible. The card is twenty times the area, and those same values
 *    on it read as dust rather than texture — bigger, fainter, slower, and more
 *    of them. See BADGE_DRIFT and CARD_DRIFT.
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
  /** vertical travel in px, signed */
  bob: number
}

const KINDS: DecorKind[] = ["circle", "square", "slash"]

/** Round to 2dp — keeps the SVG small and the output stable to compare in tests. */
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * How dense and how large the texture is.
 *
 * The defaults are the badge's, tuned by looking at it at 1×. The card is
 * twenty times the area and needs its own numbers: the same values there
 * produce a handful of specks in a lot of empty space, which reads as dust
 * rather than as texture.
 */
export interface DriftOptions {
  /** px of width per shape, before the cap */
  density?: number
  maxCount?: number
  minSize?: number
  sizeRange?: number
  minOpacity?: number
  opacityRange?: number
  /** max horizontal travel in px */
  travel?: number
  /** max vertical travel in px, applied in the keyframes */
  bob?: number
}

export const BADGE_DRIFT: Required<DriftOptions> = {
  density: 22,
  maxCount: 7,
  minSize: 1.8,
  sizeRange: 2.6,
  minOpacity: 0.14,
  opacityRange: 0.14,
  travel: 11,
  bob: 1.2,
}

export const CARD_DRIFT: Required<DriftOptions> = {
  density: 34,
  maxCount: 16,
  minSize: 3,
  sizeRange: 9,
  minOpacity: 0.05,
  opacityRange: 0.07,
  travel: 26,
  bob: 9,
}

/**
 * Lay out the drifting shapes.
 *
 * Count scales with width so a short badge does not get as crowded as a long
 * one, and is capped: past a point these stop reading as texture and start
 * reading as dirt on the screen.
 */
export function driftShapes(
  seed: number,
  width: number,
  height: number,
  options: DriftOptions = {},
): DecorShape[] {
  const o = { ...BADGE_DRIFT, ...options }
  const rand = makeRandom(seed)
  const count = Math.max(3, Math.min(o.maxCount, Math.round(width / o.density)))
  const out: DecorShape[] = []

  // Shapes must stay clear of the top and bottom edges by their bob, or they
  // vanish for part of each cycle and the surface looks like it is flickering.
  const margin = o.bob + 1
  const span = Math.max(0, height - margin * 2)

  for (let i = 0; i < count; i++) {
    const duration = r2(7 + rand() * 11)
    out.push({
      kind: KINDS[Math.floor(rand() * KINDS.length)],
      // Spread across the width in bands, jittered, so they never clump.
      x: r2(((i + rand()) / count) * width),
      y: r2(margin + rand() * span),
      size: r2(o.minSize + rand() * o.sizeRange),
      opacity: r2(o.minOpacity + rand() * o.opacityRange),
      duration,
      delay: r2(-rand() * duration),
      travel: r2((rand() < 0.5 ? -1 : 1) * (o.travel * 0.35 + rand() * o.travel * 0.65)),
      bob: r2((i % 2 ? 1 : -1) * (o.bob * 0.4 + rand() * o.bob * 0.6)),
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
        `@keyframes d${i}{0%{transform:translate(${s.x}px,${s.y}px)}50%{transform:translate(${r2(s.x + s.travel)}px,${r2(s.y + s.bob)}px)}100%{transform:translate(${s.x}px,${s.y}px)}}`,
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

/**
 * A hue for this repository, in degrees.
 *
 * Drawn from a different part of the seed than the shapes so that two projects
 * whose textures happen to look alike still get different colours.
 */
export function hueFromSeed(seed: number): number {
  const rand = makeRandom(seed ^ 0x9e3779b9)
  return Math.round(rand() * 360)
}

/** HSL → `#rrggbb`. SVG renderers vary in their support for `hsl()`; hex does not. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(1, s))
  const ll = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2
  const seg = Math.floor(hh / 60) % 6
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg]
  const hex = (v: number) =>
    clamp255((v + m) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
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
