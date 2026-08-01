import { describe, it, expect, beforeEach } from "vitest"
import { themeInitScript, DEFAULT_THEME, THEME_IDS, isDarkTheme } from "@/lib/themes"

/**
 * The pre-paint theme script, executed rather than pattern-matched.
 *
 * It shipped for months as `(!function(){…})()`, which parses cleanly and throws
 * the moment it runs: the function is negated to `false`, and `false` is then
 * called. Its own `catch` is inside the function, so it could not help. Every
 * page therefore loaded with no `data-theme` until React hydrated — a theme
 * flash on load, and a console TypeError whose stack pointed into a framework
 * chunk rather than at us.
 *
 * A test that only looked for substrings would have passed throughout. These run
 * the string, which is the only check that could have caught it.
 */

interface FakeElement {
  attributes: Record<string, string>
  classes: Set<string>
}

function run(stored: string | null): { el: FakeElement; threw: unknown } {
  const el: FakeElement = { attributes: {}, classes: new Set() }
  const documentElement = {
    setAttribute: (k: string, v: string) => {
      el.attributes[k] = v
    },
    classList: {
      toggle: (name: string, on: boolean) => {
        if (on) el.classes.add(name)
        else el.classes.delete(name)
      },
      add: (name: string) => el.classes.add(name),
    },
  }
  const document = { documentElement }
  const localStorage = { getItem: () => stored }

  let threw: unknown = null
  try {
    new Function("document", "localStorage", themeInitScript())(document, localStorage)
  } catch (e) {
    threw = e
  }
  return { el, threw }
}

describe("themeInitScript", () => {
  let dark: string
  let light: string

  beforeEach(() => {
    dark = THEME_IDS.find((id) => isDarkTheme(id)) as string
    light = THEME_IDS.find((id) => !isDarkTheme(id)) as string
  })

  it("runs without throwing", () => {
    // The whole bug, in one assertion.
    expect(run(null).threw).toBeNull()
  })

  it("falls back to the default theme when nothing is stored", () => {
    const { el } = run(null)
    expect(el.attributes["data-theme"]).toBe(DEFAULT_THEME)
  })

  it("applies a stored dark theme and the dark class", () => {
    const { el } = run(dark)
    expect(el.attributes["data-theme"]).toBe(dark)
    expect(el.classes.has("dark")).toBe(true)
  })

  it("applies a stored light theme without the dark class", () => {
    const { el } = run(light)
    expect(el.attributes["data-theme"]).toBe(light)
    expect(el.classes.has("dark")).toBe(false)
  })

  it("ignores a stored value that is not a known theme", () => {
    // Someone else's "theme" key, or one this build no longer ships.
    const { el } = run("chartreuse-deluxe")
    expect(el.attributes["data-theme"]).toBe(DEFAULT_THEME)
  })
})
