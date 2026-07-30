"use client"

import { Activity, GitBranch, KeyRound, Boxes } from "lucide-react"
import { useRouter } from "next/navigation"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { useLocale } from "@/components/i18n/locale-provider"
import type { MessageKey } from "@/lib/i18n"
import { ScanRunner } from "./scan-runner"

const features: { icon: typeof KeyRound; title: MessageKey; body: MessageKey }[] = [
  { icon: KeyRound, title: "feature.secrets.title", body: "feature.secrets.body" },
  { icon: Boxes, title: "feature.dead.title", body: "feature.dead.body" },
  { icon: GitBranch, title: "feature.branches.title", body: "feature.branches.body" },
]

/**
 * The first thing a visitor sees.
 *
 * The scan form is on the page, not behind a "Run your first scan" button. The
 * button was a step that asked people to commit before showing them what they
 * were committing to; a landing page whose entire purpose is "paste a repo URL"
 * should show the box you paste into.
 *
 * The decoration is CSS only — a radial wash behind the hero and a hairline grid.
 * No images, no animation library. This page is the first impression of a tool
 * that reports on dependency bloat, so it does not get to ship a carousel.
 */
export function WelcomeScreen() {
  const { t } = useLocale()
  const router = useRouter()

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      {/* Soft primary wash behind the hero, fading out before the fold. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[36rem] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]"
      />
      {/* Hairline grid, masked so it dissolves rather than ending in a hard edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] opacity-[0.18] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)] [background-image:linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:56px_56px]"
      />

      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-16 md:py-24">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/15 text-primary shadow-sm">
            <Activity className="size-8" />
          </div>

          <h1 className="mt-6 text-balance bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-4xl font-semibold tracking-tight text-transparent md:text-5xl">
            {t("welcome.title")}
          </h1>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            {t("welcome.lead")}
          </p>
        </div>

        <div className="mt-10">
          {/* The result cards offer "Open" only when there is somewhere to open
              into. There is now: the dashboard is its own route, so the report
              can be handed over by id instead of hoping it sorts to the top. */}
          <ScanRunner
            onOpen={(repoId) => router.push(`/app?repo=${encodeURIComponent(repoId)}`)}
          />
        </div>

        <div className="mt-16 grid gap-4 text-left sm:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card/50 p-5 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-card"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </div>
              <p className="mt-3.5 text-sm font-medium">{t(f.title)}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(f.body)}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
