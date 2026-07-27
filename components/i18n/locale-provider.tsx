"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  t as translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n"

/**
 * Locale state for the public pages.
 *
 * The choice lives in a cookie, not in localStorage, because the shared-report
 * page is server-rendered: a link opened cold has to come back in the reader's
 * language on the first paint, and the server can only see cookies. localStorage
 * would mean a flash of English followed by a swap.
 */

interface LocaleContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

/** One year: a language preference is not something to ask about twice. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function persist(locale: Locale): void {
  if (typeof document === "undefined") return
  // `SameSite=Lax` so the cookie survives a shared link followed from elsewhere.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
}

export function LocaleProvider({
  initial,
  children,
}: {
  /** Resolved server-side from cookie + Accept-Language, so SSR and the client agree. */
  initial?: Locale
  children: ReactNode
}) {
  const [locale, setLocaleState] = useState<Locale>(
    isLocale(initial) ? initial : DEFAULT_LOCALE,
  )

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persist(next)
    // Keep the document language in sync — it drives screen-reader pronunciation
    // and browser translation prompts, both of which get it wrong otherwise.
    if (typeof document !== "undefined") document.documentElement.lang = next
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Read the current locale.
 *
 * Falls back to English outside a provider rather than throwing, so a component
 * can be dropped into the untranslated dashboard without taking the page down.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (ctx) return ctx
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  }
}
