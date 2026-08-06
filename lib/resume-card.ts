/**
 * The big resume card: a poster-sized SVG built from structured facts.
 *
 * ## Why this one is a generator after all
 *
 * It started as a one-off script that hard-coded one person's details, which was
 * the right shape for producing a single image once. A card you can edit is a
 * different object: the layout has to survive a stat tile being deleted, a bio
 * getting longer, a project list of two or of nine. So the flow layout is the
 * feature here, not an accident of tidiness.
 *
 * ## Pure, and free of Node
 *
 * No `node:` imports, no `process`, no fetch. That is deliberate: the editor
 * imports this straight into a client component and re-renders the preview on
 * every keystroke. A generator that needed a server round trip would make live
 * editing a latency problem instead of a pure function call.
 *
 * ## Text measurement is estimated, and that is a real constraint
 *
 * SVG has no layout engine and this code cannot measure a glyph, so every wrap
 * and every chip width comes from an average advance per character. It is close
 * for prose and worst for short strings in capitals. Everything is therefore
 * laid out with slack rather than to the pixel, and anything user-supplied is
 * truncated at a length that fits even when the estimate runs under.
 */

export const RESUME_WIDTH = 1000
const PAD = 46

export interface ResumeStat {
  /** The number. Kept short — this is set at 30px. */
  value: string
  label: string
  note?: string
}

export interface ResumeStackGroup {
  group: string
  /** `name` plus the brand colour that makes the row readable at a glance. */
  items: { name: string; color: string }[]
}

export interface ResumeFocus {
  title: string
  note: string
  color: string
}

export interface ResumeProject {
  title: string
  /** "4+ months · core team" — the line under the title. */
  meta: string
  body: string
  tags: string[]
  color: string
}

export interface ResumeLink {
  label: string
  value: string
  color: string
}

export interface ResumeCardData {
  handle: string
  headline: string
  /** "· Bots · Automation · Scripts · AI" — the quieter half of the title line. */
  subtitle: string
  summary: string
  /** Green pill, top right. Empty string hides it. */
  availability: string
  stats: ResumeStat[]
  stack: ResumeStackGroup[]
  focus: ResumeFocus[]
  projects: ResumeProject[]
  education: {
    degree: string
    place: string
    notes: string[]
    certificates: string[]
  }
  about: string
  hobbies: string[]
  contact: { title: string; note: string }
  links: ResumeLink[]
}

const THEME = {
  bg0: "#0d1117",
  bg1: "#11161f",
  stroke: "#252c37",
  text: "#e9eef5",
  soft: "#c2cbd6",
  muted: "#8b95a3",
  dim: "#69727f",
  panel: "#141a23",
}

/** Warm accent, taken from the handle's hue in the rest of the card system. */
export const ACCENT = "#ff9f45"

const FONT = "Segoe UI,Inter,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Estimated advance width, per character rather than per string.
 *
 * A flat average per character is wrong in the one place it matters most: chip
 * widths. A chip is sized to its own label, so the error does not average out
 * across a paragraph the way it does in prose — a label made of wide letters
 * ("useSyncExternalStore", "pnpm workspaces") measured under, and the text
 * spilled past the pill drawn around it.
 *
 * These ratios are relative to the font size, eyeballed against the Segoe UI /
 * Inter stack. Still an estimate — SVG offers no way to measure a glyph here —
 * but wrong by a few percent on a word instead of by a third.
 */
const NARROW = new Set("iljItf!.,:;'|[]()".split(""))
const WIDE = new Set("mwMW@%".split(""))
const CAPS = /[A-Z]/

function charWidth(c: string): number {
  if (c === " ") return 0.26
  if (NARROW.has(c)) return 0.3
  if (WIDE.has(c)) return 0.86
  if (c >= "0" && c <= "9") return 0.56
  if (CAPS.test(c)) return 0.67
  return 0.53
}

function tw(s: string, size: number, weight = 400): number {
  let units = 0
  for (const c of s) units += charWidth(c)
  // Semibold and bold set wider than regular at the same size.
  return units * size * (weight < 600 ? 1 : 1.06)
}

/** Monospace advances uniformly; the proportional table would misjudge it. */
function twMono(s: string, size: number): number {
  return s.length * size * 0.6
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}

/** Greedy word wrap against an estimated width. */
export function wrapText(s: string, size: number, width: number, weight = 400): string[] {
  const lines: string[] = []
  let current = ""
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (tw(candidate, size, weight) <= width) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    // A single word wider than the line would otherwise run off the card.
    current = tw(word, size, weight) > width ? truncate(word, Math.floor(width / (size * 0.545))) : word
  }
  if (current) lines.push(current)
  return lines
}

type TextOpts = {
  size?: number
  fill?: string
  weight?: number
  family?: string
  anchor?: "middle" | "end"
  letterSpacing?: string
}

function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const anchor = o.anchor ? ` text-anchor="${o.anchor}"` : ""
  const ls = o.letterSpacing ? ` letter-spacing="${o.letterSpacing}"` : ""
  return (
    `<text x="${r(x)}" y="${r(y)}" fill="${o.fill ?? THEME.text}" font-family="${o.family ?? FONT}" ` +
    `font-size="${o.size ?? 13}" font-weight="${o.weight ?? 400}"${anchor}${ls}>${esc(s)}</text>`
  )
}

const r = (n: number) => Math.round(n * 100) / 100

function panel(x: number, y: number, w: number, h: number, radius = 12, fill = THEME.panel): string {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${radius}" fill="${fill}" stroke="${THEME.stroke}" stroke-width="1"/>`
}

/** FNV-1a, matching `lib/badge-decor.ts` so one handle gives one texture. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Section heading: numeral, label, and a rule filling the rest of the width. */
function section(y: number, label: string, n: number): { svg: string; y: number } {
  const upper = label.toUpperCase()
  const lw = tw(upper, 12, 700) + 30
  return {
    svg:
      text(PAD, y, String(n).padStart(2, "0"), { size: 12, fill: ACCENT, weight: 700, family: MONO }) +
      text(PAD + 30, y, upper, { size: 12, fill: THEME.muted, weight: 700, letterSpacing: "0.16em" }) +
      `<line x1="${r(PAD + lw + 14)}" y1="${y - 4}" x2="${RESUME_WIDTH - PAD}" y2="${y - 4}" stroke="${THEME.stroke}" stroke-width="1"/>`,
    y: y + 26,
  }
}

/**
 * Render the card.
 *
 * Height is measured as the layout runs rather than fixed, because every
 * section here can be empty, and a card with a hole in the bottom third is
 * worse than a shorter card.
 */
export function renderResumeCardSvg(data: ResumeCardData): string {
  const out: string[] = []
  const W = RESUME_WIDTH
  let y = 92

  // ---------------------------------------------------------------- header
  //
  // Every string below is truncated to what actually fits. These are form
  // fields, so "absurdly long" is one paste away, and an untruncated headline
  // pushed the subtitle to x=5120 — five cards to the right of the card.
  const handle = truncate(`@${data.handle}`, 26)
  out.push(text(PAD, y, handle, { size: 50, weight: 800, family: MONO }))

  if (data.availability.trim()) {
    const pill = data.availability.toUpperCase()
    const pw = tw(pill, 11, 700) + 34
    out.push(
      `<rect x="${r(W - PAD - pw)}" y="${y - 30}" width="${r(pw)}" height="28" rx="14" fill="#7bd88f" opacity="0.12" stroke="#7bd88f" stroke-width="1" stroke-opacity="0.5"/>`,
      `<circle cx="${r(W - PAD - pw + 16)}" cy="${y - 16}" r="4" fill="#7bd88f"/>`,
      text(W - PAD - pw + 28, y - 12, pill, { size: 11, fill: "#7bd88f", weight: 700, letterSpacing: "0.1em" }),
    )
  }

  y += 34
  const headline = truncate(data.headline, 34)
  out.push(text(PAD, y, headline, { size: 22, fill: THEME.soft, weight: 600 }))

  // The subtitle shares the line, so it only appears when the headline leaves
  // room for it — pushed past the edge it is not a subtitle, it is a bug.
  const subtitleX = PAD + tw(headline, 22, 600) + 14
  const subtitleRoom = W - PAD - subtitleX
  if (data.subtitle.trim() && subtitleRoom > 60) {
    out.push(
      text(subtitleX, y, truncate(data.subtitle, Math.floor(subtitleRoom / (16 * 0.545))), {
        size: 16,
        fill: THEME.dim,
        weight: 500,
      }),
    )
  }

  y += 34
  for (const line of wrapText(data.summary, 15, W - PAD * 2 - 260)) {
    out.push(text(PAD, y, line, { size: 15, fill: THEME.muted }))
    y += 22
  }

  // ---------------------------------------------------------------- stats
  if (data.stats.length > 0) {
    y += 22
    const gap = 14
    const tileW = (W - PAD * 2 - gap * (data.stats.length - 1)) / data.stats.length
    data.stats.forEach((stat, i) => {
      const x = PAD + i * (tileW + gap)
      const color = [ACCENT, "#5aa9ff", "#7bd88f", "#ff6b6b"][i % 4]
      out.push(
        panel(x, y, tileW, 92),
        `<rect x="${r(x)}" y="${r(y)}" width="3" height="92" rx="1.5" fill="${color}"/>`,
        text(x + 20, y + 42, truncate(stat.value, 6), { size: 30, fill: color, weight: 800 }),
        text(x + 20, y + 62, truncate(stat.label, 22), { size: 12, weight: 600 }),
        text(x + 20, y + 79, truncate(stat.note ?? "", 30), { size: 11, fill: THEME.dim }),
      )
    })
    y += 92 + 40
  }

  // ---------------------------------------------------------------- stack
  let n = 1
  if (data.stack.length > 0) {
    const head = section(y, "Tech stack", n++)
    out.push(head.svg)
    y = head.y

    const LABEL_W = 106
    for (const { group, items } of data.stack) {
      out.push(text(PAD, y + 17, truncate(group, 14), { size: 12, fill: THEME.dim, weight: 600 }))
      let x = PAD + LABEL_W
      let rowY = y
      for (const item of items) {
        const name = truncate(item.name, 24)
        const cw = tw(name, 12.5, 600) + 26
        if (x + cw > W - PAD) {
          x = PAD + LABEL_W
          rowY += 32
        }
        out.push(
          `<rect x="${r(x)}" y="${r(rowY)}" width="${r(cw)}" height="26" rx="13" fill="${item.color}" opacity="0.10"/>`,
          `<rect x="${r(x)}" y="${r(rowY)}" width="${r(cw)}" height="26" rx="13" fill="none" stroke="${item.color}" stroke-opacity="0.34" stroke-width="1"/>`,
          `<circle cx="${r(x + 13)}" cy="${r(rowY + 13)}" r="3.5" fill="${item.color}"/>`,
          text(x + 23, rowY + 17.5, name, { size: 12.5, fill: THEME.soft, weight: 600 }),
        )
        x += cw + 8
      }
      y = rowY + 38
    }
    y += 30
  }

  // ---------------------------------------------------------------- focus
  if (data.focus.length > 0) {
    const head = section(y, "Key focus areas", n++)
    out.push(head.svg)
    y = head.y

    const colW = (W - PAD * 2 - 16) / 2
    data.focus.forEach((item, i) => {
      const cx = PAD + (i % 2) * (colW + 16)
      const cy = y + Math.floor(i / 2) * 46
      out.push(
        `<circle cx="${r(cx + 7)}" cy="${r(cy + 15)}" r="4" fill="${item.color}"/>`,
        `<circle cx="${r(cx + 7)}" cy="${r(cy + 15)}" r="8" fill="none" stroke="${item.color}" stroke-opacity="0.3" stroke-width="1"/>`,
        text(cx + 26, cy + 13, truncate(item.title, 32), { size: 14, weight: 700 }),
        text(cx + 26, cy + 31, truncate(item.note, 52), { size: 12, fill: THEME.muted }),
      )
    })
    y += Math.ceil(data.focus.length / 2) * 46 + 34
  }

  // ---------------------------------------------------------------- projects
  if (data.projects.length > 0) {
    const head = section(y, "Selected projects", n++)
    out.push(head.svg)
    y = head.y

    const cardW = (W - PAD * 2 - 16) / 2
    // Each row is as tall as its taller card, so the two columns keep a shared
    // baseline however uneven the copy is.
    const bodies = data.projects.map((p) => wrapText(p.body, 12.5, cardW - 40))
    const heights = bodies.map((lines) => 70 + lines.length * 17 + 30)
    const rowHeights: number[] = []
    for (let i = 0; i < heights.length; i += 2) {
      rowHeights.push(Math.max(heights[i], heights[i + 1] ?? 0))
    }

    data.projects.forEach((project, i) => {
      const row = Math.floor(i / 2)
      const col = i % 2
      const px = PAD + col * (cardW + 16)
      const py = y + rowHeights.slice(0, row).reduce((a, b) => a + b, 0) + row * 14
      out.push(
        panel(px, py, cardW, rowHeights[row]),
        `<rect x="${r(px)}" y="${r(py)}" width="${r(cardW)}" height="3" rx="1.5" fill="${project.color}" opacity="0.85"/>`,
        text(px + 20, py + 34, truncate(project.title, 34), { size: 15, weight: 700 }),
        text(px + 20, py + 53, truncate(project.meta, 34), {
          size: 11.5,
          fill: project.color,
          weight: 600,
          family: MONO,
        }),
      )
      let ly = py + 76
      for (const line of bodies[i]) {
        out.push(text(px + 20, ly, line, { size: 12.5, fill: THEME.muted }))
        ly += 17
      }
      let tx = px + 20
      for (const tag of project.tags.slice(0, 4)) {
        const label = truncate(tag, 18)
        const cw = tw(label, 10.5, 600) + 16
        out.push(
          `<rect x="${r(tx)}" y="${r(ly + 2)}" width="${r(cw)}" height="20" rx="10" fill="${project.color}" opacity="0.10"/>`,
          text(tx + cw / 2, ly + 16, label, { size: 10.5, fill: project.color, weight: 600, anchor: "middle" }),
        )
        tx += cw + 6
      }
    })
    y += rowHeights.reduce((a, b) => a + b, 0) + (rowHeights.length - 1) * 14 + 46
  }

  // ---------------------------------------------------------------- education
  const head = section(y, "Education & about", n++)
  out.push(head.svg)
  y = head.y

  const leftW = (W - PAD * 2) * 0.54
  const rightX = PAD + leftW + 16
  const rightW = W - PAD - rightX
  const aboutLines = wrapText(data.about, 12, rightW - 40)
  // One height for both panels: two boxes of different heights side by side is
  // the sort of thing you notice before you read anything on them.
  const boxH = Math.max(
    92 + data.education.notes.length * 17 + data.education.certificates.length * 17,
    92 + aboutLines.length * 17,
    148,
  )

  out.push(
    panel(PAD, y, leftW, boxH),
    text(PAD + 20, y + 32, truncate(data.education.degree, 40), { size: 14, weight: 700 }),
    text(PAD + 20, y + 52, truncate(data.education.place, 40), {
      size: 12,
      fill: ACCENT,
      weight: 600,
      family: MONO,
    }),
  )
  let ey = y + 76
  for (const note of data.education.notes) {
    out.push(text(PAD + 20, ey, truncate(note, 52), { size: 12, fill: THEME.muted }))
    ey += 17
  }
  if (data.education.certificates.length > 0) {
    ey += 8
    out.push(`<line x1="${r(PAD + 20)}" y1="${r(ey - 12)}" x2="${r(PAD + leftW - 20)}" y2="${r(ey - 12)}" stroke="${THEME.stroke}"/>`)
    for (const cert of data.education.certificates) {
      out.push(text(PAD + 20, ey + 4, truncate(cert, 52), { size: 12, fill: THEME.soft, weight: 500 }))
      ey += 17
    }
  }

  out.push(panel(rightX, y, rightW, boxH), text(rightX + 20, y + 32, "About", { size: 14, weight: 700 }))
  let ay = y + 54
  for (const line of aboutLines) {
    out.push(text(rightX + 20, ay, line, { size: 12, fill: THEME.muted }))
    ay += 17
  }
  if (data.hobbies.length > 0) {
    // Chips rather than emoji: outside a browser those rasterise as tofu.
    const hy = y + boxH - 26
    out.push(`<line x1="${r(rightX + 20)}" y1="${r(hy - 22)}" x2="${r(rightX + rightW - 20)}" y2="${r(hy - 22)}" stroke="${THEME.stroke}"/>`)
    let hx = rightX + 20
    for (const hobby of data.hobbies) {
      const label = truncate(hobby, 16)
      const hw = tw(label, 11, 500) + 18
      if (hx + hw > rightX + rightW - 20) break
      out.push(
        `<rect x="${r(hx)}" y="${r(hy - 13)}" width="${r(hw)}" height="19" rx="9.5" fill="${THEME.stroke}" opacity="0.7"/>`,
        text(hx + hw / 2, hy, label, { size: 11, fill: THEME.soft, weight: 500, anchor: "middle" }),
      )
      hx += hw + 6
    }
  }
  y += boxH + 36

  // ---------------------------------------------------------------- contact
  out.push(
    panel(PAD, y, W - PAD * 2, 76, 14, "#121821"),
    `<rect x="${r(PAD)}" y="${r(y)}" width="4" height="76" rx="2" fill="url(#rc-accent)"/>`,
    text(PAD + 26, y + 32, truncate(data.contact.title, 30), { size: 16, weight: 700 }),
    text(PAD + 26, y + 54, truncate(data.contact.note, 70), { size: 12, fill: THEME.muted }),
  )

  let lx = W - PAD - 20
  for (const link of [...data.links].reverse()) {
    const value = truncate(link.value, 34)
    const label = link.label.toUpperCase()
    // The value is set in monospace, the label is not.
    const bw = Math.max(twMono(value, 12), tw(label, 10, 700)) + 32
    lx -= bw
    out.push(
      `<rect x="${r(lx)}" y="${r(y + 16)}" width="${r(bw)}" height="44" rx="10" fill="${link.color}" opacity="0.10" stroke="${link.color}" stroke-opacity="0.35"/>`,
      text(lx + bw / 2, y + 33, label, {
        size: 9.5,
        fill: link.color,
        weight: 700,
        anchor: "middle",
        letterSpacing: "0.1em",
      }),
      text(lx + bw / 2, y + 50, value, { size: 12, fill: THEME.soft, weight: 600, anchor: "middle", family: MONO }),
    )
    lx -= 12
  }
  y += 76 + PAD

  const H = Math.round(y)

  // Background texture, seeded from the handle so it matches the person card.
  const rand = mulberry32(hashSeed(data.handle.toLowerCase()))
  const marks: string[] = []
  for (let i = 0; i < 150; i++) {
    const mx = rand() * W
    const my = rand() * H
    const radius = 1.5 + rand() * 5
    const tone = [ACCENT, "#ff6b6b", "#5aa9ff", "#7bd88f"][Math.floor(rand() * 4)]
    const opacity = r(0.05 + rand() * 0.1)
    marks.push(
      rand() < 0.45
        ? `<circle cx="${r(mx)}" cy="${r(my)}" r="${r(radius)}" fill="none" stroke="${tone}" stroke-width="1" opacity="${opacity}"/>`
        : `<circle cx="${r(mx)}" cy="${r(my)}" r="${r(radius)}" fill="${tone}" opacity="${opacity}"/>`,
    )
  }

  const aria = `@${data.handle} — ${data.headline}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
<title>${esc(aria)}</title>
<defs>
  <linearGradient id="rc-bg" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0%" stop-color="${THEME.bg1}"/><stop offset="100%" stop-color="${THEME.bg0}"/>
  </linearGradient>
  <radialGradient id="rc-glow">
    <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.16"/>
    <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="rc-accent" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${ACCENT}"/><stop offset="100%" stop-color="#ff6b6b"/>
  </linearGradient>
  <clipPath id="rc-clip"><rect width="${W}" height="${H}" rx="20"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#rc-bg)"/>
<g clip-path="url(#rc-clip)">${marks.join("")}</g>
<ellipse cx="${r(W * 0.24)}" cy="-40" rx="460" ry="230" fill="url(#rc-glow)"/>
${out.join("\n")}
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="${THEME.stroke}" stroke-width="1"/>
</svg>`
}
