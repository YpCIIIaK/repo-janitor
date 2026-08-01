"use client"

import { Activity } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale } from "@/components/i18n/locale-provider"
import { ScanRunner } from "./scan-runner"
import { LandingSections } from "./landing-sections"

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

      {/* Two widths on purpose: the hero and the scan form stay in a narrow
          column, because a centred headline and a single input read badly when
          stretched, while the sections below carry six dense cards and want the
          room. */}
      <main className="mx-auto w-full max-w-5xl px-4 py-16 md:py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
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

        <div className="mx-auto mt-10 max-w-3xl">
          {/* The result cards offer "Open" only when there is somewhere to open
              into. There is now: the dashboard is its own route, so the report
              can be handed over by id instead of hoping it sorts to the top. */}
          <ScanRunner
            onOpen={(repoId) => router.push(`/app?repo=${encodeURIComponent(repoId)}`)}
          />
        </div>

        <LandingSections />
      </main>
    </div>
  )
}
