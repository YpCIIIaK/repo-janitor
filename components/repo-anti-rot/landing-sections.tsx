"use client"

import {
  ShieldAlert,
  Package,
  Workflow,
  BookOpen,
  Hourglass,
  Scissors,
  Lock,
  } from "lucide-react"
import { Github } from "@/components/icons/github"
import { useLocale } from "@/components/i18n/locale-provider"
import type { MessageKey } from "@/lib/i18n"
import {
  CHECK_FAMILIES,
  GRADE_BANDS,
  PENALTIES,
  TOTAL_CHECKS,
  type CheckFamily,
} from "@/lib/landing-facts"
import { computeScore, issuesFromCounts, scoreToGrade } from "@/lib/score"
import { ScanSummarySection } from "./scan-summary-section"
import { PenaltyBreakdownList } from "@/components/repo-anti-rot/penalty-breakdown"

/**
 * Everything on the landing page below the scan form.
 *
 * The page used to be a hero, a form and three vague cards, for a tool that runs
 * twenty-six checks and stores almost nothing. A visitor could not tell what it
 * would look at, what a grade meant, or what happened to their code — the three
 * questions anyone has before pasting a repository URL into a stranger's site.
 *
 * Every number and every claim here is read from the code rather than written by
 * hand: the check families list real scanner ids, the grade bands come from
 * `scoreToGrade`, the penalties from `DEFAULT_WEIGHTS`, and the privacy text
 * matches what `app/api/scan/route.ts` and `lib/usage.ts` actually do. A landing
 * page for a tool that grades honesty does not get to round any of it up.
 */

/** Icon per family. Lives here because the facts module stays free of React. */
const ICONS: Record<CheckFamily["id"], typeof ShieldAlert> = {
  security: ShieldAlert,
  deps: Package,
  ci: Workflow,
  docs: BookOpen,
  decay: Hourglass,
  code: Scissors,
}

/** Colour per grade band, in the same order the dashboard uses. */
const BAND_TONE: Record<string, string> = {
  A: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  B: "text-lime-500 border-lime-500/30 bg-lime-500/10",
  C: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  D: "text-orange-500 border-orange-500/30 bg-orange-500/10",
}

const REPO_URL = "https://github.com/YpCIIIaK/repo-janitor#github-action"

/** Concrete example used in the grade section — kept here so the numbers in
 *  copy and in PenaltyBreakdownList cannot drift apart. */
const GRADE_EXAMPLE = { critical: 3, warning: 5 } as const

export function LandingSections() {
  const { t } = useLocale()
  const exampleIssues = issuesFromCounts(GRADE_EXAMPLE)
  const exampleScore = computeScore(exampleIssues)
  const exampleGrade = scoreToGrade(exampleScore)

  return (
    <>
      {/* ---- what it checks ------------------------------------------------ */}
      <section className="mt-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight">
          {t("landing.checks.title", { count: TOTAL_CHECKS })}
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("landing.checks.lead")}
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHECK_FAMILIES.map((f) => {
            const Icon = ICONS[f.id]
            return (
            <div
              key={f.id}
              className="rounded-xl border border-border bg-card/50 p-5 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <p className="text-sm font-medium">{t(f.title)}</p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t(f.body)}</p>
              <ul className="mt-3.5 flex flex-wrap gap-1.5">
                {f.scanners.map((id) => (
                  <li
                    key={id}
                    className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] leading-5 text-muted-foreground"
                  >
                    {id}
                  </li>
                ))}
              </ul>
            </div>
            )
          })}
        </div>
      </section>

      {/* ---- how the grade works ------------------------------------------- */}
      <section className="mt-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight">
          {t("landing.grade.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("landing.grade.lead", {
            critical: `−${PENALTIES.critical}`,
            warning: `−${PENALTIES.warning}`,
            info: `−${PENALTIES.info}`,
          })}
        </p>

        {/* The thresholds are written as maths, not prose: "≥ 90" needs no
            translating and cannot drift between the two dictionaries. */}
        <div className="mt-6 flex flex-wrap gap-2">
          {GRADE_BANDS.map((b) => (
            <div
              key={b.grade}
              className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 text-sm ${BAND_TONE[b.grade]}`}
            >
              <span className="text-lg font-semibold">{b.grade}</span>
              <span className="text-xs tabular-nums opacity-80">≥ {b.min}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            <span className="text-lg font-semibold">F</span>
            <span className="text-xs tabular-nums opacity-80">
              &lt; {GRADE_BANDS[GRADE_BANDS.length - 1].min}
            </span>
          </div>
        </div>

        <div className="mt-8 max-w-md rounded-xl border border-border bg-card/50 p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("landing.grade.exampleLead", {
              critical: String(GRADE_EXAMPLE.critical),
              warning: String(GRADE_EXAMPLE.warning),
              score: String(exampleScore),
              grade: exampleGrade,
            })}
          </p>
          <PenaltyBreakdownList issues={exampleIssues} className="mt-4 border-t border-border pt-3" />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {t("landing.grade.meaningA")}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("landing.grade.meaningF")}
          </p>
        </div>
      </section>

      {/* ---- what everything scanned looks like ----------------------------
          Straight after the grade explanation: the reader has just learned what
          the letters mean, and this is where they find out what an ordinary
          repository actually gets. Renders nothing until the sample is big
          enough to be worth saying. */}
      <ScanSummarySection />

      {/* ---- what happens to your code -------------------------------------
          Placed before the CI section on purpose: this is the question a
          visitor has while their cursor is in the URL box, not after. */}
      <section className="mt-20 rounded-xl border border-border bg-card/40 p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lock className="size-5" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{t("landing.privacy.title")}</h2>
        </div>
        <ul className="mt-4 grid gap-3 text-sm leading-relaxed text-muted-foreground sm:grid-cols-3">
          {(["clone", "report", "usage"] as const).map((k) => (
            <li key={k} className="border-l-2 border-border pl-3">
              {t(`landing.privacy.${k}` as MessageKey)}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- CI --------------------------------------------------------- */}
      <section className="mt-20 mb-8">
        <h2 className="text-balance text-2xl font-semibold tracking-tight">
          {t("landing.ci.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("landing.ci.lead")}
        </p>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {t("landing.ci.badge")}
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3.5 py-2 text-sm transition-colors hover:border-primary/30 hover:bg-card"
        >
          <Github className="size-4" />
          {t("landing.ci.repo")}
        </a>
      </section>
    </>
  )
}
