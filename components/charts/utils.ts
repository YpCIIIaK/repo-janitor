/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/charts/utils.ts).
 * Copied verbatim so the kit's chart components drop in unedited. Keep in sync
 * by hand — the kit is a copy-paste library, not a package.
 */

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
]

export function niceCeil(value: number) {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = Math.pow(10, exp)
  const f = value / base
  let nf: number
  if (f <= 1) nf = 1
  else if (f <= 2) nf = 2
  else if (f <= 5) nf = 5
  else nf = 10
  return nf * base
}

export function ticks(max: number, count = 4) {
  const step = max / count
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i))
}

/** Round to 2 decimals — keeps SSR and client SVG path strings identical. */
export function r2(n: number) {
  return Math.round(n * 100) / 100
}

/** Build a smooth (catmull-rom -> bezier) path through points. */
export function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return ""
  const d: string[] = [`M ${r2(pts[0][0])} ${r2(pts[0][1])}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 > pts.length - 1 ? pts.length - 1 : i + 2]
    const t = 0.16
    const c1x = p1[0] + (p2[0] - p0[0]) * t
    const c1y = p1[1] + (p2[1] - p0[1]) * t
    const c2x = p2[0] - (p3[0] - p1[0]) * t
    const c2y = p2[1] - (p3[1] - p1[1]) * t
    d.push(`C ${r2(c1x)} ${r2(c1y)}, ${r2(c2x)} ${r2(c2y)}, ${r2(p2[0])} ${r2(p2[1])}`)
  }
  return d.join(" ")
}

export function linePath(pts: [number, number][]) {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${r2(p[0])} ${r2(p[1])}`).join(" ")
}

/** Deterministic seeded PRNG (mulberry32) for stable demo data across SSR. */
export function seededRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
