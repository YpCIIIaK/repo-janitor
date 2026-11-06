"use client"

import { useRouter } from "next/navigation"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { FindingsBreakdown } from "@/components/repo-anti-rot/findings-breakdown"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { ThemeSwitcher } from "@/components/theme-switcher"

/** Public page: anonymous breakdown of what each rule finds across the benchmark. */
export default function FindingsPage() {
  const router = useRouter()
  return (
    <div className="min-h-screen">
      <TopBar
        onHome={() => router.push("/")}
        extras={
          <>
            <ThemeSwitcher />
            <LanguageSwitcher />
          </>
        }
      />
      <FindingsBreakdown />
    </div>
  )
}
