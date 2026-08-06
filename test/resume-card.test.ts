import { describe, expect, it } from "vitest"

import { RESUME_WIDTH, renderResumeCardSvg, wrapText } from "@/lib/resume-card"
import { DEFAULT_RESUME } from "@/lib/resume-card-defaults"

/**
 * The editor lets every list be emptied and every string be pasted into, so
 * these are mostly about the layout surviving input rather than about looks.
 */
describe("renderResumeCardSvg", () => {
  it("produces a standalone SVG", () => {
    const svg = renderResumeCardSvg(DEFAULT_RESUME)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain(`width="${RESUME_WIDTH}"`)
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true)
  })

  it("shrinks rather than leaving a hole when sections are emptied", () => {
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1])
    const full = height(renderResumeCardSvg(DEFAULT_RESUME))
    const bare = height(
      renderResumeCardSvg({ ...DEFAULT_RESUME, stats: [], stack: [], focus: [], projects: [] }),
    )
    expect(bare).toBeLessThan(full)
    expect(bare).toBeGreaterThan(300)
  })

  it("survives every list being empty", () => {
    expect(() =>
      renderResumeCardSvg({
        ...DEFAULT_RESUME,
        stats: [],
        stack: [],
        focus: [],
        projects: [],
        hobbies: [],
        links: [],
        education: { degree: "", place: "", notes: [], certificates: [] },
      }),
    ).not.toThrow()
  })

  it("escapes every field rather than letting one write markup", () => {
    // Everything on this card is typed by a person into a form.
    const svg = renderResumeCardSvg({
      ...DEFAULT_RESUME,
      headline: "<script>alert(1)</script>",
      about: '"><script>x</script>',
      hobbies: ["<b>"],
    })
    expect(svg).not.toContain("<script")
    expect(svg).toContain("&lt;")
  })

  it("hides the availability pill when it is blank", () => {
    // Asserted on the pill's own text: the green also appears in the background
    // texture palette, so searching for the colour proves nothing. Taken from
    // the data rather than written out, so editing the copy is not a test
    // failure — the behaviour under test is the hiding, not the wording.
    const pill = DEFAULT_RESUME.availability.toUpperCase()
    expect(pill).not.toBe("")
    expect(renderResumeCardSvg({ ...DEFAULT_RESUME, availability: "" })).not.toContain(pill)
    expect(renderResumeCardSvg(DEFAULT_RESUME)).toContain(pill)
  })

  it("is deterministic for the same input", () => {
    // The background texture is seeded from the handle, not re-rolled.
    expect(renderResumeCardSvg(DEFAULT_RESUME)).toBe(renderResumeCardSvg(DEFAULT_RESUME))
  })

  it("gives different handles different textures", () => {
    const a = renderResumeCardSvg(DEFAULT_RESUME)
    const b = renderResumeCardSvg({ ...DEFAULT_RESUME, handle: "octocat" })
    expect(a).not.toBe(b)
  })

  it("grows with the project list instead of overlapping", () => {
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1])
    const two = height(renderResumeCardSvg({ ...DEFAULT_RESUME, projects: DEFAULT_RESUME.projects.slice(0, 2) }))
    const six = height(renderResumeCardSvg(DEFAULT_RESUME))
    expect(six).toBeGreaterThan(two)
  })

  it("does not run text off the card when a field is absurdly long", () => {
    // A form field is one paste away from being 400 characters long.
    for (const field of ["headline", "subtitle", "handle"] as const) {
      const svg = renderResumeCardSvg({ ...DEFAULT_RESUME, [field]: "x".repeat(400) })
      const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]))
      for (const x of xs) expect(x).toBeLessThanOrEqual(RESUME_WIDTH)
    }
  })
})

describe("wrapText", () => {
  it("wraps on words", () => {
    expect(wrapText("one two three four", 12, 60).length).toBeGreaterThan(1)
  })

  it("truncates a single unbreakable word instead of overflowing", () => {
    const lines = wrapText("x".repeat(300), 12, 100)
    expect(lines).toHaveLength(1)
    expect(lines[0].length).toBeLessThan(300)
  })

  it("returns nothing for empty input", () => {
    expect(wrapText("   ", 12, 100)).toEqual([])
  })
})
