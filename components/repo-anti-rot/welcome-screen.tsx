"use client"

import { useState } from "react"
import { Activity, GitBranch, KeyRound, Boxes, ScanLine, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { useLocale } from "@/components/i18n/locale-provider"
import type { MessageKey } from "@/lib/i18n"
import { ScanRunner } from "./scan-runner"

const features: { icon: typeof KeyRound; title: MessageKey; body: MessageKey }[] = [
  { icon: KeyRound, title: "feature.secrets.title", body: "feature.secrets.body" },
  { icon: Boxes, title: "feature.dead.title", body: "feature.dead.body" },
  { icon: GitBranch, title: "feature.branches.title", body: "feature.branches.body" },
]

export function WelcomeScreen() {
  const [scanning, setScanning] = useState(false)
  const { t } = useLocale()

  if (scanning) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScanning(false)}
            className="text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("scan.back")}
          </Button>
          <LanguageSwitcher />
        </div>
        <div className="mb-6">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">{t("scan.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("scan.lead")}</p>
        </div>
        <ScanRunner />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-16 text-center md:py-24">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <Activity className="size-8" />
      </div>

      <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight">
        {t("welcome.title")}
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-muted-foreground">{t("welcome.lead")}</p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={() => setScanning(true)}>
          <ScanLine className="size-4" />
          {t("welcome.cta")}
        </Button>
      </div>

      <div className="mt-14 grid w-full gap-4 text-left sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-card/40 p-4">
            <f.icon className="size-5 text-primary" />
            <p className="mt-3 text-sm font-medium">{t(f.title)}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(f.body)}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
