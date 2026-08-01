"use client"

import { useRouter } from "next/navigation"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { TopBar } from "@/components/repo-anti-rot/top-bar"

/**
 * Minimal product chrome for a shared report.
 *
 * The report body is server-rendered (and must stay that way for cold links),
 * so theme/language live here as a thin client island. Changing language
 * reloads the page: the cookie is what SSR reads, and a client-only swap would
 * leave the body in the old locale.
 */
export function ShareChrome() {
  const router = useRouter()

  return (
    <TopBar
      onHome={() => router.push("/")}
      extras={
        <>
          <ThemeSwitcher />
          <LanguageSwitcher reloadOnChange />
        </>
      }
    />
  )
}
