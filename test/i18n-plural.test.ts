import { describe, it, expect } from "vitest"
import { LOCALES, messages, tp, type MessageKey } from "@/lib/i18n"

/**
 * Counted messages.
 *
 * English gets away with appending an "s", which is what the code did before:
 * `${n} open issue${n === 1 ? "" : "s"}`. Russian has three forms and picks
 * between them on the last digit, with exceptions — 21 behaves like 1, and 111
 * behaves like 5. Hand-rolling that is how a translated interface ends up saying
 * "21 находок".
 */

describe("tp", () => {
  it("picks the English singular only for one", () => {
    expect(tp("en", "issues.open", 1)).toBe("1 open issue")
    for (const n of [0, 2, 5, 21, 101]) {
      expect(tp("en", "issues.open", n)).toBe(`${n} open issues`)
    }
  })

  it("follows the Russian rule, including the cases that catch people out", () => {
    const ru = (n: number) => tp("ru", "issues.open", n)
    expect(ru(1)).toBe("1 открытая находка")
    expect(ru(21)).toBe("21 открытая находка") // ends in 1, but 11 does not
    expect(ru(101)).toBe("101 открытая находка")

    expect(ru(2)).toBe("2 открытые находки")
    expect(ru(4)).toBe("4 открытые находки")
    expect(ru(22)).toBe("22 открытые находки")

    expect(ru(0)).toBe("0 открытых находок")
    expect(ru(5)).toBe("5 открытых находок")
    expect(ru(11)).toBe("11 открытых находок") // the exception to "ends in 1"
    expect(ru(111)).toBe("111 открытых находок")
  })

  it("substitutes the count without being told to", () => {
    // `count` is passed implicitly, so a caller cannot forget it and ship a
    // sentence with a literal "{count}" in it.
    expect(tp("en", "issues.open", 3)).not.toContain("{")
    expect(tp("ru", "issues.open", 3)).not.toContain("{")
  })
})

describe("dictionaries", () => {
  it("give every locale exactly the English key set", () => {
    // The type system already enforces this; the test states it as behaviour so
    // a future locale added at runtime cannot slip through with holes in it.
    const english = Object.keys(messages.en) as MessageKey[]
    for (const locale of LOCALES) {
      const keys = Object.keys(messages[locale])
      expect(keys.length).toBe(english.length)
      for (const key of english) expect(messages[locale][key]).toBeTruthy()
    }
  })

  it("leaves no untranslated copies in Russian for the strings just added", () => {
    // A key that exists but still holds the English text is worse than a missing
    // one: it type-checks, renders, and looks finished.
    for (const key of ["nav.repositories", "table.title", "drawer.age", "app.settings"] as const) {
      expect(messages.ru[key]).not.toBe(messages.en[key])
    }
  })
})
