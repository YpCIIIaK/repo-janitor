"use client"

import { useRouter } from "next/navigation"
import { useLocale } from "@/components/i18n/locale-provider"
import { CHECK_FAMILIES, TOTAL_CHECKS } from "@/lib/landing-facts"
import { ScanRunner } from "./scan-runner"
import { ProofRepos } from "./proof-repos"
import { LandingSections } from "./landing-sections"

/**
 * The first thing a visitor sees.
 *
 * The scan form is on the page, not behind a "Run your first scan" button. The
 * button was a step that asked people to commit before showing them what they
 * were committing to; a landing page whose entire purpose is "paste a repo URL"
 * should show the box you paste into.
 *
 * The headline names the problem rather than the product. "Welcome to Repo
 * Anti-Rot" told a stranger nothing they did not already know from the tab
 * title; "your repo is rotting, nobody committed it" is the one sentence that
 * explains why a tool like this exists at all.
 *
 * The three figures beside it are read from `lib/landing-facts.ts`, which
 * `test/landing-facts.test.ts` checks against the engine's own scanner registry.
 * A hero that quietly claims twenty-seven checks after someone deleted one is
 * exactly the decay this project reports on, and it would be embarrassing here.
 * The third figure is zero, and it is the honest one: nothing on this page is a
 * mock-up of a scan that never ran.
 *
 * Decoration is CSS only — a hairline grid and a blurred wash, both mixed from
 * the theme's own colours so the page survives all eight themes including the
 * light ones. No images, no animation library. This is the first impression of a
 * tool that reports on bloat, so it does not get to ship a carousel.
 */
export function WelcomeScreen() {
  const { t } = useLocale()
  const router = useRouter()

  const figures = [
    { label: t("hero.checks"), value: String(TOTAL_CHECKS), accent: false },
    { label: t("hero.families"), value: String(CHECK_FAMILIES.length), accent: false },
    { label: t("hero.mock"), value: "0", accent: true },
  ]

  return (
    <div className="min-h-screen">
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(100%_70%_at_50%_0%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/12 blur-[120px]"
        />

        <div className="relative mx-auto grid max-w-6xl items-start gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:py-24">
          <div className="flex flex-col items-start lg:sticky lg:top-24">
            <span className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <span aria-hidden className="blink-dot size-1.5 rounded-full bg-primary" />
              {t("hero.eyebrow")}
            </span>

            <h1 className="mt-6 text-pretty text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              {t("hero.titleTop")}
              <br />
              <span className="text-muted-foreground">{t("hero.titleBottom")}</span>
            </h1>

            <p className="mt-5 max-w-lg text-pretty leading-relaxed text-muted-foreground">
              {t("welcome.lead")}
            </p>

            <dl className="mt-8 grid w-full max-w-lg grid-cols-3 divide-x divide-border border-y border-border">
              {figures.map((f, i) => (
                <div key={f.label} className={i === 0 ? "py-4 pr-4" : "px-4 py-4 last:pr-0"}>
                  <dt className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                    {f.label}
                  </dt>
                  <dd
                    className={`tabnum mt-1 font-mono text-2xl font-semibold ${
                      f.accent ? "text-primary" : ""
                    }`}
                  >
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-6 max-w-lg font-mono text-xs leading-relaxed text-muted-foreground">
              {t("hero.note")}
            </p>
          </div>

          {/* The real scan form, in the slot a marketing page would fill with a
              screenshot of one. */}
          <div className="w-full min-w-0">
            <ScanRunner
              onOpen={(repoId) => router.push(`/app?repo=${encodeURIComponent(repoId)}`)}
            />
          </div>
        </div>
      </section>

      <ProofRepos />
      <LandingSections />
    </div>
  )
}
