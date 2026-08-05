import { describe, expect, it } from "vitest"

import {
  compact,
  detailLevel,
  factRows,
  renderPersonCardSvg,
  wrapBio,
  type PersonFacts,
} from "@/lib/person-card"

import { MAX_TIER } from "@/lib/contributor-card"

const FULL: PersonFacts = {
  login: "gaearon",
  name: "dan",
  bio: "wrote some code, made some tools",
  company: "@bsky",
  location: "London, UK",
  joinedYear: 2011,
  publicRepos: 260,
  followers: 82400,
}

describe("detailLevel", () => {
  it("is lowest for a bare handle and highest for a full profile", () => {
    expect(detailLevel({ login: "octocat" })).toBe(0)
    expect(detailLevel(FULL)).toBe(MAX_TIER)
  })

  it("never exceeds the shared ladder's top", () => {
    // The two card types share cardMarks/cardPalette; a level past the top would
    // index off the end of the palette and desync them visually.
    expect(detailLevel(FULL)).toBeLessThanOrEqual(MAX_TIER)
  })

  it("treats an empty string as absent, not as a fact", () => {
    expect(detailLevel({ login: "a", name: "", bio: "" })).toBe(0)
  })

  it("counts a zero as known", () => {
    // Zero repositories is a fact about somebody; blank is the absence of one.
    expect(detailLevel({ login: "a", publicRepos: 0 })).toBeGreaterThan(
      detailLevel({ login: "a" }),
    )
  })
})

describe("the handle is the only seed", () => {
  it("keeps the accent colour when the facts change", () => {
    // A person who edits their bio must get their card back. The accent is drawn
    // from the login, so it is the cheapest thing to assert this on.
    const accent = (svg: string) => /<text x="22" y="76" fill="(#[0-9a-f]{6})"/.exec(svg)?.[1]

    const bare = renderPersonCardSvg({ login: "gaearon" })
    const full = renderPersonCardSvg(FULL)
    expect(accent(bare)).toBe(accent(full))
    expect(accent(bare)).toBeTruthy()
  })

  it("gives different people different colours", () => {
    const accent = (svg: string) => /<text x="22" y="76" fill="(#[0-9a-f]{6})"/.exec(svg)?.[1]
    expect(accent(renderPersonCardSvg({ login: "octocat" }))).not.toBe(
      accent(renderPersonCardSvg({ login: "torvalds" })),
    )
  })

  it("is stable across renders and case-insensitive about the handle", () => {
    expect(renderPersonCardSvg(FULL)).toBe(renderPersonCardSvg(FULL))
    const marks = (svg: string) => /<g clip-path="url\(#pclip[^)]*\)">([\s\S]*?)<\/g>\n/.exec(svg)?.[1]
    expect(marks(renderPersonCardSvg({ login: "OctoCat" }))).toBe(
      marks(renderPersonCardSvg({ login: "octocat" })),
    )
  })
})

describe("wrapBio", () => {
  it("splits on words within the line budget", () => {
    const lines = wrapBio("wrote some code and made some tools for people", 20, 3)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20)
  })

  it("truncates a single unbreakable word rather than overflowing", () => {
    // Bios contain URLs often enough that this is not hypothetical; an unbroken
    // string would otherwise run off the edge of the card.
    const lines = wrapBio("https://example.com/a/very/long/path/that/never/ends", 20, 2)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20)
  })

  it("marks a bio that did not fit instead of dropping the rest silently", () => {
    const lines = wrapBio("one two three four five six seven eight nine ten", 12, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/…$/)
  })

  it("does not mark a bio that fitted", () => {
    const lines = wrapBio("short bio", 34, 2)
    expect(lines).toEqual(["short bio"])
  })

  it("handles an empty or whitespace bio", () => {
    expect(wrapBio("   ")).toEqual([])
  })
})

describe("factRows", () => {
  it("keeps a fixed order regardless of which facts exist", () => {
    const all = factRows(FULL).map(([label]) => label)
    const some = factRows({ login: "a", location: "Oslo", followers: 5 }).map(([label]) => label)
    // "location" precedes "followers" in both, so a wall of cards can be read
    // by position rather than searched.
    expect(all.indexOf("location")).toBeLessThan(all.indexOf("followers"))
    expect(some).toEqual(["location", "followers"])
  })

  it("omits unknown facts rather than printing blanks", () => {
    expect(factRows({ login: "a" })).toEqual([])
  })

  it("keeps every known fact instead of dropping the last one", () => {
    // A cap of four used to lose the follower count on a full profile: the card
    // showed less the more it was told.
    expect(factRows(FULL).map(([label]) => label)).toEqual([
      "company",
      "location",
      "joined",
      "public repos",
      "followers",
    ])
  })
})

describe("compact", () => {
  it("shortens large counts", () => {
    expect(compact(999)).toBe("999")
    expect(compact(1200)).toBe("1.2k")
    expect(compact(82400)).toBe("82k")
    expect(compact(2_300_000)).toBe("2.3M")
  })

  it("refuses to render nonsense", () => {
    expect(compact(Number.NaN)).toBe("0")
    expect(compact(-5)).toBe("0")
  })
})

describe("renderPersonCardSvg", () => {
  it("produces a standalone SVG", () => {
    const svg = renderPersonCardSvg(FULL)
    expect(svg).toContain("<svg")
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
  })

  it("works from nothing but a handle", () => {
    // The whole reason this file exists: somebody who has done nothing here, and
    // told us nothing about themselves, still gets a card.
    const svg = renderPersonCardSvg({ login: "octocat" })
    expect(svg).toContain("@octocat")
    expect(svg).toContain("<svg")
  })

  it("falls back to the handle when there is no display name", () => {
    const svg = renderPersonCardSvg({ login: "octocat" })
    expect(svg).toContain(">octocat<")
  })

  it("escapes every field rather than letting one write markup", () => {
    const svg = renderPersonCardSvg({
      login: "a",
      name: '<script>alert(1)</script>',
      bio: '"><script>x</script>',
      location: "<b>",
    })
    expect(svg).not.toContain("<script")
    expect(svg).toContain("&lt;")
  })

  it("gives each card unique defs ids so a row cannot share a gradient", () => {
    const a = renderPersonCardSvg({ login: "octocat" })
    const b = renderPersonCardSvg({ login: "torvalds" })
    const id = (svg: string) => /id="pbg-([^"]+)"/.exec(svg)?.[1]
    expect(id(a)).toBeTruthy()
    expect(id(a)).not.toBe(id(b))
  })

  it("does not collide with the contributor card's ids", () => {
    expect(renderPersonCardSvg(FULL)).not.toContain('id="cbg-')
  })

  it("renders both themes", () => {
    const dark = renderPersonCardSvg(FULL, { theme: "dark" })
    const light = renderPersonCardSvg(FULL, { theme: "light" })
    expect(dark).not.toBe(light)
    expect(light).toContain("#f6f8fa")
  })
})
