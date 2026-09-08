"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowRight, ListChecks, Search, TrendingUp } from "lucide-react"
import { useLocale } from "@/components/i18n/locale-provider"
import { CHECK_FAMILIES, TOTAL_CHECKS } from "@/lib/landing-facts"
import { ScanRunner } from "./scan-runner"
import { LandingSections } from "./landing-sections"

/** Keep the real form beside the promise and offer a report before asking for a scan. */
export function WelcomeScreen() {
  const { t } = useLocale()
  const router = useRouter()

  const figures = [
    { label: t("hero.checks"), value: String(TOTAL_CHECKS), accent: false },
    { label: t("hero.families"), value: String(CHECK_FAMILIES.length), accent: false },
    { label: t("hero.account"), value: "0", accent: true },
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

            <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href="#scan" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90">
                {t("hero.scan")}<ArrowRight className="size-4" />
              </a>
              <Link href="/demo" className="inline-flex items-center justify-center rounded-lg border border-border bg-card/60 px-4 py-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("hero.demo")}
              </Link>
            </div>

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
          <div id="scan" className="w-full min-w-0 scroll-mt-20">
            <ScanRunner
              onOpen={(repoId) => router.push(`/app?repo=${encodeURIComponent(repoId)}`)}
            />
          </div>
        </div>
      </section>

      <section aria-label={t("hero.resultLabel")} className="border-b border-border bg-card/20">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <ol className="grid gap-6 md:grid-cols-3">
            {[
              { icon: Search, title: t("hero.resultFind"), body: t("hero.resultFindBody") },
              { icon: ListChecks, title: t("hero.resultPlan"), body: t("hero.resultPlanBody") },
              { icon: TrendingUp, title: t("hero.resultRepeat"), body: t("hero.resultRepeatBody") },
            ].map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="min-w-0">
                <div className="flex items-center gap-2 text-primary"><Icon className="size-4" /><span className="font-mono text-xs">0{i + 1}</span></div>
                <h2 className="mt-3 text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">{t("hero.limits")}</p>
        </div>
      </section>
      <LandingSections />
    </div>
  )
}
