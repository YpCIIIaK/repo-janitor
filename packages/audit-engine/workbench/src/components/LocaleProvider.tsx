"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { common, interpolate, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

type CommonKey = keyof typeof common.ru;
type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  tr: (ru: string, en: string, values?: Record<string, string | number>) => string;
  t: (key: CommonKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  const toggleLocale = useCallback(() => setLocale(locale === "ru" ? "en" : "ru"), [locale, setLocale]);
  const tr = useCallback(
    (ru: string, en: string, values?: Record<string, string | number>) =>
      interpolate(locale === "ru" ? ru : en, values),
    [locale],
  );
  const t = useCallback((key: CommonKey) => common[locale][key], [locale]);

  const value = useMemo(() => ({ locale, setLocale, toggleLocale, tr, t }), [locale, setLocale, toggleLocale, tr, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
