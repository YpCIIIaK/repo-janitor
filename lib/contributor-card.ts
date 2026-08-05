/**
 * A card for a person, generated from what they have actually done here.
 *
 * Experimental and deliberately self-contained: nothing in the dashboard imports
 * this yet. It renders from a plain `ContributorSignals` value, so it can be
 * previewed and judged (see `/card-lab`) before anything is wired to real data.
 *
 * ## Two inputs that must not be confused
 *
 * The login is the *seed*: hue, lattice geometry and mark shapes come from it and
 * from nothing else. The signals are the *content*: they decide how much
 * structure gets drawn on top. Keeping them apart is the whole design. If colour
 * moved with the score the card would look like a different person's every time
 * it updated, and a card nobody recognises is not worth having on a profile.
 *
 * ## Why it grows by density rather than by unlocks
 *
 * The alternative — foil, holograms, a rarity ladder — reads as a loot box, and a
 * loot box is a thing you farm. Here the card is always the same card: the
 * lattice thickens, the palette widens from two colours to four, the marks gain a
 * second layer. It ends up looking like a record of work rather than a prize,
 * and there is nothing to farm because the tier is capped and the signals behind
 * it are not volume.
 *
 * ## Why these signals
 *
 * Commit count is the obvious input and the wrong one: it rewards splitting a
 * change into six, which is exactly the habit this project exists to discourage.
 * Each signal here resists that.
 *
 * - **Confirmed false positives** need a maintainer to agree the rule was broken
 *   (see `lib/hunter.ts`), so they cannot be self-issued.
 * - **Clean weeks** count time without a regression in the areas someone owns.
 *   It is the one signal that cannot be rushed at all — a week takes a week.
 * - **Areas touched** counts distinct parts of the tree, not changes, so the
 *   tenth commit to the same file adds nothing.
 *
 * ## Why the ladder stops
 *
 * Six tiers and then nothing. Unbounded growth turns a two-year contributor's
 * card into unreadable noise and tells a newcomer the gap is not closeable.
 * Past the top the intended direction is sideways — more marks of different
 * kinds, not more shine.
 */

import {
  hashSeed,
  hslToHex,
  hueFromSeed,
  makeRandom,
  shade,
} from "@/lib/badge-decor"

export const CARD_WIDTH = 300
export const CARD_HEIGHT = 420

/** Portrait, so it reads as a card rather than as another badge. */
const PAD = 22

export interface ContributorSignals {
  /** Issues labelled `false-positive: confirmed` authored by this person. */
  confirmedFalsePositives: number
  /** Consecutive weeks with no score regression in the areas they touch. */
  cleanStreakWeeks: number
  /** Distinct areas of the tree they have changed — breadth, not volume. */
  areasTouched: number
}

export const NO_SIGNALS: ContributorSignals = {
  confirmedFalsePositives: 0,
  cleanStreakWeeks: 0,
  areasTouched: 0,
}

/**
 * Weights, and the reasoning for the gaps between them.
 *
 * A confirmed false positive is worth several clean weeks because it is the
 * scarcest thing on the list: it costs someone else's review time to grant, and
 * it is the only signal that improves the scanner itself. Breadth is worth
 * slightly more than a clean week because it is harder to hold — knowing four
 * areas well enough to change them is real, where four quiet weeks can just mean
 * four quiet weeks.
 */
const WEIGHTS = {
  confirmedFalsePositives: 4,
  cleanStreakWeeks: 1,
  areasTouched: 1.5,
} as const

/**
 * Caps per signal, applied before weighting.
 *
 * Without them one dimension can carry the whole card: twenty quiet weeks would
 * reach the top tier alone, which would make the card a measure of tenure. The
 * caps force the ladder to be climbed on more than one axis, and they keep the
 * arithmetic honest for someone who has been here for years.
 */
const CAPS: ContributorSignals = {
  confirmedFalsePositives: 4,
  cleanStreakWeeks: 12,
  areasTouched: 6,
}

export function cardPoints(signals: ContributorSignals): number {
  const clamp = (n: number, cap: number) =>
    Math.max(0, Math.min(cap, Math.floor(Number.isFinite(n) ? n : 0)))

  return (
    clamp(signals.confirmedFalsePositives, CAPS.confirmedFalsePositives) *
      WEIGHTS.confirmedFalsePositives +
    clamp(signals.cleanStreakWeeks, CAPS.cleanStreakWeeks) * WEIGHTS.cleanStreakWeeks +
    clamp(signals.areasTouched, CAPS.areasTouched) * WEIGHTS.areasTouched
  )
}

/**
 * Points at which each tier starts.
 *
 * The steps widen deliberately. The first is one confirmed report or a couple of
 * quiet weeks — reachable by accident, which is the point: a card that stays
 * blank until someone has earned it is a card nobody ever sees change. The last
 * needs sustained work on more than one axis.
 *
 * The top sits below the sum of the caps (37) on purpose. Set equal to it and
 * the final tier would demand every signal maxed simultaneously — one missing
 * area would hold someone at four forever, which is a ladder with a locked top
 * step rather than a ladder.
 */
export const TIER_THRESHOLDS = [0, 3, 8, 15, 23, 31] as const

export const MAX_TIER = TIER_THRESHOLDS.length - 1

/**
 * Names, not just numbers. A tier number invites comparison — "I'm a 2, you're a
 * 4" — where a name describes a role and reads as a fact about someone's
 * relationship with the repository.
 */
export const TIER_NAMES = [
  "Passing through",
  "Reporter",
  "Regular",
  "Keeper",
  "Steward",
  "Warden",
] as const

export function tierOf(points: number): number {
  let tier = 0
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (points >= TIER_THRESHOLDS[i]) tier = i
  }
  return tier
}

/**
 * How far along the current tier someone is, 0–1, and what the next step costs.
 *
 * The card shows this because a level on its own is a verdict, where "two more
 * clean weeks" is an invitation. At the top there is no next step and the bar is
 * full — saying "maxed" plainly beats inventing a seventh tier to point at.
 */
export function tierProgress(points: number): {
  tier: number
  ratio: number
  pointsToNext: number | null
} {
  const tier = tierOf(points)
  if (tier >= MAX_TIER) return { tier, ratio: 1, pointsToNext: null }

  const start = TIER_THRESHOLDS[tier]
  const next = TIER_THRESHOLDS[tier + 1]
  const span = next - start

  return {
    tier,
    ratio: span > 0 ? Math.max(0, Math.min(1, (points - start) / span)) : 1,
    pointsToNext: Math.max(0, next - points),
  }
}

/**
 * One concrete thing that would move someone up, in their own numbers.
 *
 * "Points" are an implementation detail nobody should have to reason about, so
 * the line names a signal instead.
 *
 * ## Why it is not simply the smallest number
 *
 * Ranking the routes by how many of each is needed sounds obviously right and is
 * wrong here. A confirmed report is worth four clean weeks, so it wins that
 * comparison almost always, and every card ends up telling everyone to go file
 * false-positive reports — the one route that depends on a maintainer agreeing,
 * and the one where pressure produces junk in the issue tracker. Advice at scale
 * shapes behaviour, so the order is fixed instead: the routes someone controls
 * alone come first, and reports are suggested only when nothing else closes the
 * gap.
 *
 * ## Why it can suggest a partial step
 *
 * Caps mean the remaining distance sometimes cannot be covered by any single
 * signal — three clean weeks left and two reports left, needing the two
 * together. Returning nothing there would render as "top tier" on a tier-four
 * card, which is a lie. Instead the line falls back to the largest step still
 * available and says it moves them closer rather than promising the tier.
 */
export function nextStepHint(signals: ContributorSignals): string | null {
  const { tier, pointsToNext } = tierProgress(cardPoints(signals))
  if (tier >= MAX_TIER || pointsToNext === null) return null

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  // Order is the priority order: self-directed first, maintainer-gated last.
  const routes = [
    {
      left: Math.max(0, CAPS.cleanStreakWeeks - Math.floor(signals.cleanStreakWeeks)),
      weight: WEIGHTS.cleanStreakWeeks,
      label: (n: number) => plural(n, "clean week", "clean weeks"),
    },
    {
      left: Math.max(0, CAPS.areasTouched - Math.floor(signals.areasTouched)),
      weight: WEIGHTS.areasTouched,
      label: (n: number) => plural(n, "new area", "new areas"),
    },
    {
      left: Math.max(0, CAPS.confirmedFalsePositives - Math.floor(signals.confirmedFalsePositives)),
      weight: WEIGHTS.confirmedFalsePositives,
      label: (n: number) => plural(n, "confirmed report", "confirmed reports"),
    },
  ].filter((r) => r.left > 0)

  for (const route of routes) {
    const need = Math.ceil(pointsToNext / route.weight)
    if (need <= route.left) return `Next tier: ${route.label(need)}`
  }

  // Nothing finishes it alone. Name the biggest remaining move, most valuable
  // first, so the card still points somewhere real.
  const best = [...routes].sort((a, b) => b.left * b.weight - a.left * a.weight)[0]
  if (!best) return null
  return `Closer: ${best.label(best.left)}`
}

/** A mark in the background lattice. Position is on a grid; the rest is seeded. */
export interface CardMark {
  x: number
  y: number
  size: number
  opacity: number
  /** Index into the tier's palette. */
  tone: number
  rotate: number
  kind: "dot" | "bar" | "ring"
}

const MARK_KINDS: CardMark["kind"][] = ["dot", "bar", "ring"]

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Lattice density per tier: columns of marks across the card.
 *
 * A grid rather than the scattered drift of `badge-decor` — this card is
 * portrait and mostly texture, and free scatter at this size clumps into
 * something that looks like a rendering fault. The grid also makes growth
 * legible: two cards side by side differ in a way you can count.
 */
const TIER_COLUMNS = [3, 4, 5, 6, 7, 8] as const

/**
 * Colours per tier: two at the bottom, four at the top.
 *
 * All of them are rotations off the same seeded hue, so widening the palette
 * enriches the card without ever making it a different colour. The offsets are
 * small and fixed — a full colour wheel would produce combinations that clash
 * for some seeds, and there is no designer in the loop to catch those.
 */
const TIER_TONES = [2, 2, 3, 3, 4, 4] as const

const TONE_OFFSETS = [0, 28, -24, 52] as const

export function cardPalette(seed: number, tier: number, dark: boolean): string[] {
  const hue = hueFromSeed(seed)
  const count = TIER_TONES[Math.max(0, Math.min(MAX_TIER, tier))]

  return TONE_OFFSETS.slice(0, count).map((offset, i) =>
    dark
      ? hslToHex(hue + offset, 0.52, 0.58 + i * 0.04)
      : hslToHex(hue + offset, 0.58, 0.44 + i * 0.04),
  )
}

/**
 * Lay out the lattice.
 *
 * Marks sit on grid cells with a jitter under half a cell, so the structure
 * stays readable while no two cards line up identically. Higher tiers add a
 * second, smaller mark inside a share of the cells — the "second layer" that
 * makes a Warden's card denser without making it larger.
 */
export function cardMarks(seed: number, tier: number): CardMark[] {
  const t = Math.max(0, Math.min(MAX_TIER, tier))
  const cols = TIER_COLUMNS[t]
  const rand = makeRandom(seed ^ 0x5bf03635)
  const tones = TIER_TONES[t]

  const field = { x: PAD, y: 150, w: CARD_WIDTH - PAD * 2, h: 138 }
  const cellW = field.w / cols
  const rows = Math.max(2, Math.round(field.h / cellW))
  const cellH = field.h / rows

  // Marks are sized off a fixed unit rather than off the cell, which is the one
  // thing the first draft got wrong badly enough to look like a bug. Cells are
  // twice as wide at tier 0 as at tier 5, so cell-relative sizing made the
  // emptiest card the one with the biggest blobs on it — the ladder appeared to
  // run backwards. Constant size, varying count: growth reads as accumulation.
  const unit = field.w / TIER_COLUMNS[MAX_TIER]

  // Cells this tier fills a second time. Zero for the first half of the ladder:
  // the early card should look sparse and calm, or later growth reads as noise
  // rather than as having gone somewhere.
  const secondLayer = t >= 3 ? 0.25 + (t - 3) * 0.15 : 0

  const out: CardMark[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = field.x + (col + 0.5) * cellW
      const cy = field.y + (row + 0.5) * cellH
      const jx = (rand() - 0.5) * cellW * 0.45
      const jy = (rand() - 0.5) * cellH * 0.45

      out.push({
        x: r2(cx + jx),
        y: r2(cy + jy),
        size: r2(unit * (0.16 + rand() * 0.14)),
        opacity: r2(0.28 + rand() * 0.34),
        tone: Math.floor(rand() * tones),
        rotate: Math.round(rand() * 180),
        kind: MARK_KINDS[Math.floor(rand() * MARK_KINDS.length)],
      })

      if (rand() < secondLayer) {
        out.push({
          x: r2(cx - jx * 0.6),
          y: r2(cy - jy * 0.6),
          size: r2(unit * (0.07 + rand() * 0.06)),
          opacity: r2(0.2 + rand() * 0.25),
          tone: Math.floor(rand() * tones),
          rotate: Math.round(rand() * 180),
          kind: MARK_KINDS[Math.floor(rand() * MARK_KINDS.length)],
        })
      }
    }
  }
  return out
}

function markBody(m: CardMark, fill: string): string {
  switch (m.kind) {
    case "dot":
      return `<circle r="${m.size}" fill="${fill}" opacity="${m.opacity}"/>`
    case "bar":
      return `<rect x="${r2(-m.size)}" y="${r2(-m.size * 0.32)}" width="${r2(m.size * 2)}" height="${r2(m.size * 0.64)}" rx="${r2(m.size * 0.32)}" fill="${fill}" opacity="${m.opacity}"/>`
    case "ring":
      return `<circle r="${m.size}" fill="none" stroke="${fill}" stroke-width="${r2(Math.max(0.8, m.size * 0.3))}" opacity="${m.opacity}"/>`
  }
}

type Theme = "dark" | "light"

const SURFACE: Record<Theme, { bg0: string; bg1: string; stroke: string; text: string; muted: string; dim: string; track: string }> = {
  dark: {
    bg0: "#161b22",
    bg1: "#0d1117",
    stroke: "#30363d",
    text: "#e6edf3",
    muted: "#8b949e",
    dim: "#6e7681",
    track: "#21262d",
  },
  light: {
    bg0: "#ffffff",
    bg1: "#f6f8fa",
    stroke: "#d0d7de",
    text: "#1f2328",
    muted: "#656d76",
    dim: "#8b949e",
    track: "#eaeef2",
  },
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}

const FONT = "Segoe UI,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

export interface ContributorCardOptions {
  theme?: Theme
}

/**
 * Render the card.
 *
 * Pure and synchronous: the caller supplies both the login and the signals, so
 * this can be unit-tested and previewed without a network round trip. Whatever
 * eventually feeds it — the hunter search, score history — stays outside.
 */
export function renderContributorCardSvg(
  login: string,
  signals: ContributorSignals = NO_SIGNALS,
  options: ContributorCardOptions = {},
): string {
  const theme: Theme = options.theme ?? "dark"
  const pal = SURFACE[theme]
  const dark = theme === "dark"
  const w = CARD_WIDTH
  const h = CARD_HEIGHT

  const seed = hashSeed(login.toLowerCase())
  const points = cardPoints(signals)
  const { tier, ratio } = tierProgress(points)
  const tones = cardPalette(seed, tier, dark)
  const accent = tones[0]
  const hint = nextStepHint(signals)

  // The background carries the tier too, but only just: it deepens from a wash
  // to a tint. Any more and a top-tier card stops sharing a visual family with
  // the rest, which is the thing that makes a wall of them read as one set.
  const wash = 0.04 + tier * 0.012
  const bgTint = dark ? shade(accent, -0.86 + wash) : shade(accent, 0.94 - wash)

  const marks = cardMarks(seed, tier)
    .map(
      (m) =>
        `<g transform="translate(${m.x} ${m.y}) rotate(${m.rotate})">${markBody(m, tones[m.tone % tones.length])}</g>`,
    )
    .join("")

  // SVG ids are document-global, and these cards are meant to be shown in rows.
  // Inlined side by side with fixed ids, every card after the first silently
  // adopts the first one's gradient — a whole light-theme row rendered dark
  // before this was caught. The suffix covers everything that changes the defs.
  const uid = `${(seed >>> 0).toString(36)}${tier}${theme[0]}`

  const name = truncate(login, 18)
  const tierName = TIER_NAMES[tier]
  const aria = `Repo Anti-Rot contributor card: ${login}, tier ${tier} of ${MAX_TIER}, ${tierName}`

  // Stat rows, bottom band. Values sit right-aligned so the column of numbers
  // lines up regardless of how long each label is.
  const stats: [string, string][] = [
    ["confirmed reports", String(Math.max(0, Math.floor(signals.confirmedFalsePositives)))],
    ["clean weeks", String(Math.max(0, Math.floor(signals.cleanStreakWeeks)))],
    ["areas touched", String(Math.max(0, Math.floor(signals.areasTouched)))],
  ]
  const statsTop = 316
  const statsSvg = stats
    .map(([label, value], i) => {
      const y = statsTop + i * 20
      return `<text x="${PAD}" y="${y}" fill="${pal.muted}" font-family="${FONT}" font-size="11">${esc(label)}</text><text x="${w - PAD}" y="${y}" text-anchor="end" fill="${pal.text}" font-family="${MONO}" font-size="12" font-weight="700">${esc(value)}</text>`
    })
    .join("")

  // Progress track for the next tier. Drawn even when full — a bar that vanishes
  // at the top would read as a regression.
  const barY = 296
  const barW = w - PAD * 2
  const progressSvg = `
  <rect x="${PAD}" y="${barY}" width="${barW}" height="4" rx="2" fill="${pal.track}"/>
  <rect x="${PAD}" y="${barY}" width="${r2(Math.max(2, barW * ratio))}" height="4" rx="2" fill="${accent}"/>`

  const footText = hint ?? "Top tier — nothing left to climb"

  // Pip row: the ladder, so the card states its own scale instead of leaving a
  // reader to guess whether "Keeper" is high.
  const pips = Array.from({ length: MAX_TIER + 1 }, (_, i) => {
    const filled = i <= tier
    return `<circle cx="${w - PAD - (MAX_TIER - i) * 12}" cy="118" r="3.5" fill="${filled ? accent : pal.track}"/>`
  }).join("")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">
  <title>${esc(aria)}</title>
  <defs>
    <linearGradient id="cbg-${uid}" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="${bgTint}"/>
      <stop offset="100%" stop-color="${pal.bg1}"/>
    </linearGradient>
    <clipPath id="cclip-${uid}"><rect width="${w}" height="${h}" rx="16"/></clipPath>
  </defs>

  <rect width="${w}" height="${h}" rx="16" fill="url(#cbg-${uid})" stroke="${pal.stroke}" stroke-width="1"/>
  <g clip-path="url(#cclip-${uid})">${marks}</g>

  <text x="${PAD}" y="36" fill="${pal.dim}" font-family="${FONT}" font-size="10" font-weight="600" letter-spacing="0.12em">REPO ANTI-ROT</text>
  <text x="${PAD}" y="76" fill="${pal.text}" font-family="${FONT}" font-size="24" font-weight="700">${esc(name)}</text>
  <text x="${PAD}" y="100" fill="${accent}" font-family="${FONT}" font-size="13" font-weight="600">${esc(tierName)}</text>
  <text x="${PAD}" y="122" fill="${pal.dim}" font-family="${MONO}" font-size="11">tier ${tier}/${MAX_TIER}</text>
  ${pips}

  <line x1="${PAD}" y1="136" x2="${w - PAD}" y2="136" stroke="${pal.stroke}" stroke-width="1"/>

  ${progressSvg}
  ${statsSvg}

  <text x="${PAD}" y="${h - 22}" fill="${pal.dim}" font-family="${FONT}" font-size="11">${esc(truncate(footText, 40))}</text>
</svg>`
}
