"use client"

import { useRouter } from "next/navigation"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { StateOfOpenSource } from "@/components/repo-anti-rot/state-of-oss"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { ThemeSwitcher } from "@/components/theme-switcher"

/** Public page: what the benchmark corpus says about open-source repositories. */
export default function StatePage() {
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
      <StateOfOpenSource />
    </div>
  )
}
