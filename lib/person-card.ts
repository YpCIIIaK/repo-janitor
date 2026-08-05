/**
 * A card for a person, generated from the facts about them.
 *
 * This is the plain form of the idea: hand it what is publicly known about
 * somebody and it returns a card that is recognisably theirs. No tiers, no
 * score, no requirement that they have ever touched this repository — a person
 * who has done nothing here still has a card, because the card is about who
 * they are rather than what they have earned.
 *
 * `lib/contributor-card.ts` is the other half: the same visual language wired to
 * what somebody has done here. They deliberately share `cardMarks` and
 * `cardPalette`, so one person's two cards look like two views of one identity
 * rather than like two products.
 *
 * ## The identity is the seed, and only the identity
 *
 * Hue, lattice and mark shapes come from the login and from nothing else. Not
 * from the bio, not from the follower count, not from anything that changes.
 * Somebody who edits their bio must still get their card back, otherwise the
 * card is a picture of a profile rather than a picture of a person.
 *
 * ## What may go into the seed
 *
 * Public handle only. It is tempting to hash "more" of the person for more
 * entropy — email, company, a birthday — and it is a bad idea twice over: a
 * seed derived from a private value is a private value, published as an image
 * that travels, and hashing does not undo that when the input space is small
 * enough to enumerate. There is more than enough entropy in a username.
 *
 * ## Detail follows what is known, not what is achieved
 *
 * The lattice thickens as more facts are filled in. That is not a reward — it
 * is the card being honest about how much it has to draw from. A card built
 * from a bare handle should look sparse, because that is all anyone told it.
 */

import { hashSeed } from "@/lib/badge-decor"
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  MAX_TIER,
  cardMarks,
  cardPalette,
  type MarkField,
} from "@/lib/contributor-card"

export { CARD_HEIGHT, CARD_WIDTH }

/**
 * The wide layout, for somewhere a portrait card does not belong.
 *
 * A README is a wide column of text, and a 300×420 card dropped into one reads
 * as an interruption. These proportions match the health card, so a repository
 * badge and a person card can sit in the same document without either looking
 * like it wandered in from another project.
 *
 * It is a different shape, not a different card: same seed, same texture, same
 * facts. Anything that appears only in one layout would make the two disagree
 * about who somebody is.
 */
export const WIDE_WIDTH = 480
export const WIDE_HEIGHT = 300

export type PersonCardLayout = "portrait" | "wide"

const PAD = 22

/**
 * What the card can be told about somebody.
 *
 * Everything except the handle is optional, and every field here is something a
 * person publishes about themselves on a profile page. Nothing inferred, nothing
 * derived from behaviour, nothing anybody would be surprised to see rendered.
 */
export interface PersonFacts {
  /** Public handle. The identity, and the only thing that seeds the look. */
  login: string
  /** Display name, when they have set one. */
  name?: string | null
  /** One-line self-description. Truncated hard — this is a card, not a profile. */
  bio?: string | null
  location?: string | null
  company?: string | null
  /** Year the account was created. */
  joinedYear?: number | null
  publicRepos?: number | null
  followers?: number | null

  /**
   * The detailed half, from `?detail=full`. Absent by default, because filling
   * it costs a second API call against a tighter rate limit.
   */
  topLanguage?: string | null
  starsReceived?: number | null
  /** True when the star total is summed over a sample rather than everything. */
  starsApproximate?: boolean
  bestKnown?: string | null
}

/**
 * How much the card has to work with, 0–5.
 *
 * Counted rather than weighted: no fact here is more "worth" having than
 * another, and pretending otherwise would mean deciding that a job title says
 * more about a person than where they live. Capped at the shared ladder's top
 * so the two card types cannot drift apart visually.
 */
export function detailLevel(facts: PersonFacts): number {
  const known = [
    facts.name,
    facts.bio,
    facts.location,
    facts.company,
    facts.joinedYear,
    facts.publicRepos,
    facts.followers,
  ].filter((v) => v !== null && v !== undefined && v !== "").length

  return Math.min(MAX_TIER, Math.round((known / 7) * MAX_TIER))
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

/**
 * Break a bio onto at most `maxLines` lines of roughly `perLine` characters.
 *
 * Word-based, and it gives up rather than hyphenating: a single word longer than
 * a line gets truncated on its own line. Bios contain URLs and unbroken strings
 * often enough that the alternative — letting one run off the edge of the card —
 * is not hypothetical.
 */
export function wrapBio(bio: string, perLine = 34, maxLines = 2): string[] {
  const words = bio.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    if (lines.length >= maxLines) break
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= perLine) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word.length > perLine ? truncate(word, perLine) : word
  }
  if (current && lines.length < maxLines) lines.push(current)

  // Anything that did not fit is signalled on the last line rather than dropped
  // silently, so a clipped bio never reads as the whole of what someone wrote.
  const used = lines.join(" ").replace(/…$/, "")
  if (used.length < bio.trim().length && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.endsWith("…") ? last : truncate(`${last} …`, perLine)
  }
  return lines
}

/** Compact "12400" → "12.4k" so a follower count cannot widen the row. */
export function compact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

/**
 * The fact rows, in a fixed order, skipping whatever is unknown.
 *
 * Fixed rather than "most interesting first" because a stable order is what
 * lets someone read a wall of these: the follower count is always in the same
 * place, so comparing two cards is looking, not searching.
 *
 * All five fit. An earlier cap of four silently dropped whichever came last,
 * which meant a fully filled-in profile lost its follower count — the card
 * quietly showing less the more it was told.
 */
export function factRows(facts: PersonFacts): [string, string][] {
  const rows: [string, string][] = []
  if (facts.company) rows.push(["company", truncate(facts.company, 18)])
  if (facts.location) rows.push(["location", truncate(facts.location, 18)])
  if (facts.joinedYear) rows.push(["joined", String(facts.joinedYear)])
  if (typeof facts.publicRepos === "number") rows.push(["public repos", compact(facts.publicRepos)])
  if (typeof facts.followers === "number") rows.push(["followers", compact(facts.followers)])

  // The detailed rows come last: what somebody is known for is more interesting
  // than where they live, but the profile rows are the ones every card has, and
  // a stable position beats an interesting one when two cards are compared.
  if (facts.topLanguage) rows.push(["top language", truncate(facts.topLanguage, 16)])
  if (typeof facts.starsReceived === "number") {
    // The tilde is not decoration. The total is summed over the most-starred
    // hundred, so for somebody with more than that it is a floor, and saying so
    // costs one character.
    rows.push(["stars", `${facts.starsApproximate ? "~" : ""}${compact(facts.starsReceived)}`])
  }
  if (facts.bestKnown) rows.push(["best known", truncate(facts.bestKnown, 16)])
  return rows
}

type Theme = "dark" | "light"

const SURFACE: Record<Theme, { bg1: string; stroke: string; text: string; muted: string; dim: string }> = {
  dark: {
    bg1: "#0d1117",
    stroke: "#30363d",
    text: "#e6edf3",
    muted: "#8b949e",
    dim: "#6e7681",
  },
  light: {
    bg1: "#f6f8fa",
    stroke: "#d0d7de",
    text: "#1f2328",
    muted: "#656d76",
    dim: "#8b949e",
  },
}

const FONT = "Segoe UI,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

export interface PersonCardOptions {
  theme?: Theme
  /** `"wide"` for the README-shaped card. Defaults to the portrait one. */
  layout?: PersonCardLayout
}

/**
 * Everything the two layouts disagree about, in one place.
 *
 * Gathered rather than branched through the renderer because the failure mode
 * of a second layout is the two drifting apart one `if` at a time until a fix
 * lands in one and not the other.
 */
interface Geometry {
  w: number
  h: number
  /** Baseline of the display name. */
  nameY: number
  nameSize: number
  /** Handle sits under the name on portrait, beside it on wide. */
  handleY: number
  handleAnchored: boolean
  dividerY: number
  bioY: number
  bioPerLine: number
  bioLines: number
  field: MarkField
  /** Facts run in one column on portrait, two on wide. */
  columns: number
  /** Baseline of the first fact row. */
  rowsTop: number
}

/** Row pitch and the gap the lattice keeps above the first row. */
const ROW_STEP = 20
const ROW_CLEARANCE = 16
/** Below this the lattice stops being texture and starts being a smudge. */
const MIN_FIELD_HEIGHT = 34

/**
 * `hasBio` moves the lattice, and that is the whole reason it is a parameter.
 *
 * With the field pinned below where two bio lines would go, a person who never
 * wrote one gets a band of empty card between the rule and the texture. It
 * reads as a card that failed to load rather than as a card about somebody
 * quiet, and the wide layout — half the height, same gap — shows it worst.
 */
function geometryOf(layout: PersonCardLayout, hasBio: boolean, rowCount: number): Geometry {
  // The lattice ends where the facts begin. `?detail=full` adds three rows, and
  // with a fixed bottom those rows would be drawn straight through the texture.
  const fieldHeight = (h: number, fieldY: number, columns: number) => {
    const perColumn = Math.max(1, Math.ceil(rowCount / columns))
    const rowsTop = h - 34 - (perColumn - 1) * ROW_STEP
    return {
      rowsTop,
      height: Math.max(MIN_FIELD_HEIGHT, rowsTop - ROW_CLEARANCE - fieldY),
    }
  }

  if (layout === "wide") {
    const fieldY = hasBio ? 132 : 96
    const { rowsTop, height } = fieldHeight(WIDE_HEIGHT, fieldY, 2)
    return {
      w: WIDE_WIDTH,
      h: WIDE_HEIGHT,
      nameY: 48,
      nameSize: 22,
      handleY: 48,
      handleAnchored: true,
      dividerY: 68,
      bioY: 92,
      bioPerLine: 56,
      bioLines: 2,
      field: { x: PAD, y: fieldY, w: WIDE_WIDTH - PAD * 2, h: height },
      columns: 2,
      rowsTop,
    }
  }
  const fieldY = hasBio ? 150 : 116
  const { rowsTop, height } = fieldHeight(CARD_HEIGHT, fieldY, 1)
  return {
    w: CARD_WIDTH,
    h: CARD_HEIGHT,
    nameY: 52,
    nameSize: 24,
    handleY: 76,
    handleAnchored: false,
    dividerY: 100,
    bioY: 128,
    bioPerLine: 34,
    bioLines: 2,
    field: { x: PAD, y: fieldY, w: CARD_WIDTH - PAD * 2, h: height },
    columns: 1,
    rowsTop,
  }
}

/**
 * Render the card.
 *
 * Pure and synchronous. Whatever fetches a profile stays outside, so this can be
 * unit-tested and previewed with facts typed by hand.
 */
export function renderPersonCardSvg(
  facts: PersonFacts,
  options: PersonCardOptions = {},
): string {
  const theme: Theme = options.theme ?? "dark"
  const layout: PersonCardLayout = options.layout === "wide" ? "wide" : "portrait"
  const pal = SURFACE[theme]
  const dark = theme === "dark"
  const geo = geometryOf(layout, Boolean(facts.bio?.trim()), factRows(facts).length)
  const { w, h } = geo

  const login = facts.login
  const seed = hashSeed(login.toLowerCase())
  const level = detailLevel(facts)
  const tones = cardPalette(seed, level, dark)
  const accent = tones[0]

  // Same id-collision guard as the contributor card: these are meant to be shown
  // in rows, and shared ids make every card after the first adopt the first
  // one's gradient.
  const uid = `p${(seed >>> 0).toString(36)}${level}${theme[0]}${layout[0]}`

  const marks = cardMarks(seed, level, geo.field)
    .map(
      (m) =>
        `<g transform="translate(${m.x} ${m.y}) rotate(${m.rotate})">${
          m.kind === "dot"
            ? `<circle r="${m.size}" fill="${tones[m.tone % tones.length]}" opacity="${m.opacity}"/>`
            : m.kind === "bar"
              ? `<rect x="${-m.size}" y="${-m.size * 0.32}" width="${m.size * 2}" height="${m.size * 0.64}" rx="${m.size * 0.32}" fill="${tones[m.tone % tones.length]}" opacity="${m.opacity}"/>`
              : `<circle r="${m.size}" fill="none" stroke="${tones[m.tone % tones.length]}" stroke-width="${Math.max(0.8, m.size * 0.3)}" opacity="${m.opacity}"/>`
        }</g>`,
    )
    .join("")

  const handle = truncate(`@${login}`, 22)
  // On the wide card the handle sits on the same line, so the name's budget is
  // whatever the handle leaves. A fixed budget let a long name and a long handle
  // meet in the middle.
  const nameBudget = layout === "wide" ? Math.max(10, 40 - handle.length) : 18
  const display = truncate(facts.name?.trim() || login, nameBudget)
  const bioLines = facts.bio ? wrapBio(facts.bio, geo.bioPerLine, geo.bioLines) : []
  const rows = factRows(facts)
  const aria = `Card for ${facts.name?.trim() || login} (@${login})`

  const bioSvg = bioLines
    .map(
      (line, i) =>
        `<text x="${PAD}" y="${geo.bioY + i * 17}" fill="${pal.muted}" font-family="${FONT}" font-size="12">${esc(line)}</text>`,
    )
    .join("")

  const headerSvg = geo.handleAnchored
    ? `<text x="${PAD}" y="${geo.nameY}" fill="${pal.text}" font-family="${FONT}" font-size="${geo.nameSize}" font-weight="700">${esc(display)}</text>
  <text x="${w - PAD}" y="${geo.handleY}" text-anchor="end" fill="${accent}" font-family="${MONO}" font-size="13" font-weight="600">${esc(handle)}</text>`
    : `<text x="${PAD}" y="${geo.nameY}" fill="${pal.text}" font-family="${FONT}" font-size="${geo.nameSize}" font-weight="700">${esc(display)}</text>
  <text x="${PAD}" y="${geo.handleY}" fill="${accent}" font-family="${MONO}" font-size="13" font-weight="600">${esc(handle)}</text>`

  // Rows sit against the bottom so a card with one fact and a card with five
  // share a baseline. A block that floats up as facts go missing makes a wall of
  // cards look broken.
  //
  // On the wide card they run down the left column and then the right, rather
  // than alternating across. Reading order beats visual balance here: the facts
  // are already in a fixed order, and zig-zagging through it would throw that
  // away for a slightly tidier last row.
  const perColumn = Math.max(1, Math.ceil(rows.length / geo.columns))
  const rowsTop = geo.rowsTop
  const colWidth = (w - PAD * 2) / geo.columns
  const rowsSvg = rows
    .map(([label, value], i) => {
      const col = Math.floor(i / perColumn)
      const y = rowsTop + (i % perColumn) * ROW_STEP
      const left = PAD + col * colWidth
      // Columns are gapped so the left column's value cannot touch the right
      // column's label at the widest plausible pair.
      const right = left + colWidth - (geo.columns > 1 && col === 0 ? 16 : 0)
      return `<text x="${left}" y="${y}" fill="${pal.dim}" font-family="${FONT}" font-size="11">${esc(label)}</text><text x="${right}" y="${y}" text-anchor="end" fill="${pal.text}" font-family="${MONO}" font-size="12" font-weight="700">${esc(value)}</text>`
    })
    .join("")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">
  <title>${esc(aria)}</title>
  <defs>
    <linearGradient id="pbg-${uid}" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="${accent}" stop-opacity="${dark ? 0.16 : 0.13}"/>
      <stop offset="100%" stop-color="${pal.bg1}"/>
    </linearGradient>
    <clipPath id="pclip-${uid}"><rect width="${w}" height="${h}" rx="16"/></clipPath>
  </defs>

  <rect width="${w}" height="${h}" rx="16" fill="${pal.bg1}"/>
  <rect width="${w}" height="${h}" rx="16" fill="url(#pbg-${uid})" stroke="${pal.stroke}" stroke-width="1"/>
  <g clip-path="url(#pclip-${uid})">${marks}</g>

  ${headerSvg}
  <line x1="${PAD}" y1="${geo.dividerY}" x2="${w - PAD}" y2="${geo.dividerY}" stroke="${pal.stroke}" stroke-width="1"/>
  ${bioSvg}
  ${rowsSvg}
</svg>`
}
