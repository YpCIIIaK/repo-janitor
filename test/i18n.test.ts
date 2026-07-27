import { describe, it, expect } from "vitest"
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  messages,
  negotiateLocale,
  resolveLocale,
  t,
} from "@/lib/i18n"

describe("message tables", () => {
  it("every locale defines exactly the English key set", () => {
    // The types already enforce this; the test catches a locale added via a cast
    // or an object built at runtime, where a missing key becomes a blank page.
    const englishKeys = Object.keys(messages[DEFAULT_LOCALE]).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), `locale: ${locale}`).toEqual(englishKeys)
    }
  })

  it("has no empty translations", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("")
      }
    }
  })

  it("keeps placeholders consistent across locales", () => {
    // A translation that drops {score} renders a sentence with a hole in it.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort()
    for (const [key, english] of Object.entries(messages[DEFAULT_LOCALE])) {
      for (const locale of LOCALES) {
        const translated = messages[locale][key as keyof typeof english & never]
        expect(placeholders(translated as unknown as string), `${locale}.${key}`).toEqual(
          placeholders(english),
        )
      }
    }
  })
})

describe("t", () => {
  it("returns the translation for the locale", () => {
    expect(t("en", "share.copy")).toBe("Copy link")
    expect(t("ru", "share.copy")).toBe("Скопировать ссылку")
  })

  it("substitutes placeholders", () => {
    expect(t("en", "grade.score", { score: 72 })).toBe("72/100")
    expect(t("ru", "issues.count", { count: 26 })).toBe("находок: 26")
  })

  it("leaves an unknown placeholder in place rather than printing undefined", () => {
    expect(t("en", "share.scannedAt", {})).toBe("Scanned {date}")
  })

  it("falls back to English for a bad locale instead of throwing", () => {
    // A stale or hand-edited cookie must degrade the page, not break it.
    expect(t("de" as never, "share.copy")).toBe("Copy link")
  })
})

describe("negotiateLocale", () => {
  it("defaults with no header", () => {
    expect(negotiateLocale(null)).toBe("en")
    expect(negotiateLocale("")).toBe("en")
  })

  it("matches a region subtag to its base language", () => {
    expect(negotiateLocale("ru-RU,ru;q=0.9")).toBe("ru")
  })

  it("honours quality values rather than taking the first entry", () => {
    expect(negotiateLocale("ru;q=0.4, en;q=0.9")).toBe("en")
    expect(negotiateLocale("en;q=0.3, ru;q=0.8")).toBe("ru")
  })

  it("skips languages we do not speak", () => {
    expect(negotiateLocale("de-DE,de;q=0.9,ru;q=0.5")).toBe("ru")
    expect(negotiateLocale("de-DE,fr;q=0.9")).toBe("en")
  })

  it("ignores entries explicitly refused with q=0", () => {
    expect(negotiateLocale("ru;q=0, en;q=0.5")).toBe("en")
  })

  it("survives a malformed header", () => {
    expect(negotiateLocale(";;;")).toBe("en")
    expect(negotiateLocale("ru;q=nonsense")).toBe("en")
  })
})

describe("resolveLocale", () => {
  it("prefers an explicit cookie choice over the browser's guess", () => {
    expect(resolveLocale("en", "ru-RU,ru;q=0.9")).toBe("en")
    expect(resolveLocale("ru", "en-US,en;q=0.9")).toBe("ru")
  })

  it("falls back to negotiation when the cookie is absent or junk", () => {
    expect(resolveLocale(undefined, "ru-RU")).toBe("ru")
    expect(resolveLocale("klingon", "ru-RU")).toBe("ru")
  })
})

describe("isLocale", () => {
  it("accepts known locales and rejects everything else", () => {
    expect(isLocale("en")).toBe(true)
    expect(isLocale("ru")).toBe(true)
    expect(isLocale("de")).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })
})
