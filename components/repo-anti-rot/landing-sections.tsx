"use client"

import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Hourglass,
  Lock,
  Package,
  Scissors,
  ShieldAlert,
  Workflow,
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
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import { falsePositiveUrl } from "@/lib/false-positive"
import type { Grade } from "@/lib/mock-data"
import { computeScore, issuesFromCounts, penaltyBreakdown, scoreToGrade } from "@/lib/score"
import { ScanSummarySection, useScanSummary } from "./scan-summary-section"
import { SectionLabel } from "./section-label"

/**
 * Everything on the landing page below the hero.
 *
 * The page used to be a hero, a form and three vague cards, for a tool that runs
 * twenty-six checks and stores almost nothing. A visitor could not tell what it
 * would look at, what a grade meant, or what happened to their code — the three
 * questions anyone has before pasting a repository URL into a stranger's site.
 *
 * Every number and every claim here is read from the code rather than written by
 * hand: the check families list real scanner ids, the grade bands come from
 * `scoreToGrade`, the penalties from `DEFAULT_WEIGHTS`, and the worked example's
 * ledger is computed by the same `penaltyBreakdown` the report page uses — so
 * the arithmetic shown to a stranger is the arithmetic they will get. A landing
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

/**
 * Deliberately uneven: two wide cards among four narrow ones. A perfect 3×2 grid
 * of identical cards reads as filler, and these six are not equally important.
 */
const SPANS = ["lg:col-span-2", "", "", "", "", "lg:col-span-2"]

const REPO_URL = "https://github.com/YpCIIIaK/repo-janitor#readme"

/** Concrete example used in the grade section — kept here so the numbers in
 *  copy and in the ledger cannot drift apart. */
const GRADE_EXAMPLE = { critical: 3, warning: 5 } as const

/** Severity → the CSS variable its dot and figure are tinted with. */
const SEVERITY_VAR: Record<string, string> = {
  critical: "var(--destructive)",
  warning: "var(--warning)",
  info: "var(--muted-foreground)",
}

const SEVERITY_LABEL: Record<string, MessageKey> = {
  critical: "issues.critical",
  warning: "issues.warning",
  info: "gradeCard.notes",
}

/**
 * The ruler, drawn to scale from the same thresholds the prose quotes.
 *
 * Derived rather than typed out: a hand-written "0–39" would keep saying so
 * after somebody moved the F line, and a landing page that misstates the grade
 * boundaries is a worse bug here than anywhere else. Widths are the real span of
 * each band, which is the point of drawing it — F is the widest band on the
 * scale and A is the narrowest, and no sentence conveys that as fast.
 */
const RULER: { grade: Grade; width: number; label: string }[] = (() => {
  const ascending = [...GRADE_BANDS].sort((a, b) => a.min - b.min)
  const rows: { grade: Grade; width: number; label: string }[] = []
  const lowest = ascending[0].min
  rows.push({ grade: "F", width: lowest, label: `0–${lowest - 1}` })
  ascending.forEach((band, i) => {
    // The top band ends at 100 inclusive, so its label runs to 100 while its
    // width is only ten points — keeping the row summing to exactly 100%.
    const next = ascending[i + 1]?.min
    rows.push({
      grade: band.grade as Grade,
      width: (next ?? 100) - band.min,
      label: `${band.min}–${next === undefined ? 100 : next - 1}`,
    })
  })
  return rows
})()

const NEVER_RECORDED: MessageKey[] = [
  "landing.privacy.neverPaths",
  "landing.privacy.neverCode",
  "landing.privacy.neverIp",
  "landing.privacy.neverAgents",
  "landing.privacy.neverPair",
  "landing.privacy.neverAccounts",
]

const CI_PERKS: MessageKey[] = [
  "landing.ci.perkGate",
  "landing.ci.perkSarif",
  "landing.ci.perkComment",
  "landing.ci.perkBadge",
]

const PRIVACY_STEPS: { step: string; title: MessageKey; body: MessageKey }[] = [
  { step: "01", title: "landing.privacy.cloneTitle", body: "landing.privacy.clone" },
  { step: "02", title: "landing.privacy.reportTitle", body: "landing.privacy.report" },
  { step: "03", title: "landing.privacy.usageTitle", body: "landing.privacy.usage" },
]

export function LandingSections() {
  const { t } = useLocale()
  const exampleIssues = issuesFromCounts(GRADE_EXAMPLE)
  const exampleScore = computeScore(exampleIssues)
  const exampleGrade = scoreToGrade(exampleScore)
  const ledger = penaltyBreakdown(exampleIssues).filter((p) => p.penalty > 0)
  const tapered = ledger.some((p) => p.discounted)

  // The corpus section is allowed to stay silent below the sample threshold, so
  // the numbers after it have to close the gap rather than skip a digit.
  const summary = useScanSummary()
  const num = (n: number) => String(n).padStart(2, "0")
  const corpusIndex = 3
  const privacyIndex = summary ? corpusIndex + 1 : corpusIndex

  return (
    <>
      {/* ---- 01 what it checks --------------------------------------------- */}
      <section id="checks" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <SectionLabel index="01">{t("landing.label.checks")}</SectionLabel>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("landing.checks.title", { count: TOTAL_CHECKS })}
              </h2>
              <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
                {t("landing.checks.lead")}
              </p>
            </div>
            <p className="shrink-0 font-mono text-xs text-muted-foreground">
              {t("landing.checks.aside")}
            </p>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHECK_FAMILIES.map((f, i) => {
              const Icon = ICONS[f.id]
              return (
                <li
                  key={f.id}
                  className={`group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card/60 p-5 transition-colors hover:border-primary/30 hover:bg-card ${SPANS[i]}`}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full blur-3xl transition-colors duration-500 group-hover:bg-primary/10"
                  />
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                        <Icon className="size-4" />
                      </span>
                      <h3 className="font-semibold tracking-tight">{t(f.title)}</h3>
                    </div>
                    <span className="tabnum font-mono text-xs text-muted-foreground">
                      {String(f.scanners.length).padStart(2, "0")}
                    </span>
                  </div>

                  <p className="relative mb-5 mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(f.body)}
                  </p>

                  {/* Scanner ids, printed verbatim and never translated: they are
                      the strings the CLI prints and `.repo-anti-rot.json` matches. */}
                  <ul className="relative mt-auto flex flex-wrap gap-1.5 border-t border-border/70 pt-4">
                    {f.scanners.map((id) => (
                      <li
                        key={id}
                        className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {id}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}

            <li className="flex flex-col justify-between gap-6 rounded-xl border border-dashed border-border bg-background p-5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-primary">
                  {t("landing.checks.calibration")}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.checks.calibrationBody")}
                </p>
              </div>
              <a
                href={falsePositiveUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 font-mono text-xs text-foreground transition-colors hover:text-primary"
              >
                {t("landing.checks.calibrationLink")}
                <ChevronRight className="size-3.5" />
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* ---- 02 how the grade works ---------------------------------------- */}
      <section id="scoring" className="border-b border-border bg-card/20">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.85fr] lg:gap-16 lg:py-24">
          <div>
            <SectionLabel index="02">{t("landing.label.grade")}</SectionLabel>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("landing.grade.title")}
            </h2>
            <p className="mt-3 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              {t("landing.grade.lead", {
                critical: `−${PENALTIES.critical}`,
                warning: `−${PENALTIES.warning}`,
                info: `−${PENALTIES.info}`,
              })}
            </p>

            {/* The ruler is drawn to scale, which says something prose cannot:
                F is the widest band on the scale and A is the narrowest. */}
            <div className="mt-10">
              <div className="flex items-end justify-between font-mono text-[11px] text-muted-foreground">
                <span className="tabnum">0</span>
                <span>{t("landing.grade.ruler")}</span>
                <span className="tabnum">100</span>
              </div>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full border border-border bg-background">
                {RULER.map((b) => (
                  <div
                    key={b.grade}
                    style={{ width: `${b.width}%`, backgroundColor: GRADE_CSS_VAR[b.grade] }}
                    className="opacity-80"
                  />
                ))}
              </div>
              <div className="mt-3 flex">
                {RULER.map((b) => (
                  <div
                    key={b.grade}
                    style={{ width: `${b.width}%` }}
                    className="flex flex-col items-start gap-1 border-l border-border pl-2 first:border-l-0 first:pl-0"
                  >
                    <span
                      className="flex size-6 items-center justify-center rounded font-mono text-xs font-bold"
                      style={{
                        color: GRADE_CSS_VAR[b.grade],
                        backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[b.grade]} 15%, transparent)`,
                      }}
                    >
                      {b.grade}
                    </span>
                    <span className="tabnum font-mono text-[10px] text-muted-foreground">
                      {b.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <ul className="mt-10 grid gap-3 sm:grid-cols-2">
              <li className="rounded-lg border border-border bg-background p-4">
                <p className="font-mono text-xs" style={{ color: GRADE_CSS_VAR.A }}>
                  A
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.grade.meaningA")}
                </p>
              </li>
              <li className="rounded-lg border border-border bg-background p-4">
                <p className="font-mono text-xs" style={{ color: GRADE_CSS_VAR.F }}>
                  F
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.grade.meaningF")}
                </p>
              </li>
            </ul>
          </div>

          {/* The worked example, as a ledger. Every figure below is computed by
              the scoring module at render time, so the sum shown here cannot
              disagree with what a real scan of the same shape would produce. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <figure className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              <figcaption className="flex items-center justify-between border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {t("landing.grade.ledger")}
                <span className="text-primary">score.log</span>
              </figcaption>

              <div className="divide-y divide-border font-mono text-xs">
                <div className="flex items-center justify-between px-4 py-3 text-muted-foreground">
                  <span>{t("landing.grade.start")}</span>
                  <span className="tabnum text-foreground">100.0</span>
                </div>

                {ledger.map((p) => (
                  <div key={p.severity} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: SEVERITY_VAR[p.severity] }}
                      />
                      <span className="tabnum truncate text-foreground">
                        {p.count} × {t(SEVERITY_LABEL[p.severity])}
                      </span>
                    </span>
                    <span
                      className="tabnum shrink-0"
                      style={{ color: SEVERITY_VAR[p.severity] }}
                    >
                      −{p.penalty.toFixed(1)}
                    </span>
                  </div>
                ))}

                <div className="flex items-center justify-between bg-muted/40 px-4 py-4">
                  <span className="uppercase tracking-widest text-muted-foreground">
                    {t("landing.grade.final")}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="tabnum text-2xl font-semibold text-foreground">
                      {exampleScore}
                    </span>
                    <span
                      className="flex size-7 items-center justify-center rounded text-sm font-bold"
                      style={{
                        color: GRADE_CSS_VAR[exampleGrade],
                        backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[exampleGrade]} 15%, transparent)`,
                      }}
                    >
                      {exampleGrade}
                    </span>
                  </span>
                </div>
              </div>

              {tapered && (
                <div className="border-t border-border px-4 py-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("gradeCard.taperNote")}
                  </p>
                </div>
              )}
            </figure>
          </div>
        </div>
      </section>

      {/* ---- what everything scanned looks like -----------------------------
          Straight after the grade explanation: the reader has just learned what
          the letters mean, and this is where they find out what an ordinary
          repository actually gets. Renders nothing until the sample is big
          enough to be worth saying. */}
      {summary && <ScanSummarySection summary={summary} index={num(corpusIndex)} />}

      {/* ---- what happens to your code --------------------------------------
          Placed before the CI section on purpose: this is the question a
          visitor has while their cursor is in the URL box, not after. */}
      <section id="privacy" className="relative overflow-hidden border-b border-border bg-card/20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(80%_60%_at_50%_50%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="max-w-2xl">
            <SectionLabel index={num(privacyIndex)}>{t("landing.label.privacy")}</SectionLabel>
            <h2 className="mt-4 flex items-center gap-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Lock className="size-4" />
              </span>
              {t("landing.privacy.title")}
            </h2>
          </div>

          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {PRIVACY_STEPS.map((s) => (
              <li key={s.step} className="rounded-xl border border-border bg-background p-5">
                <span className="tabnum font-mono text-xs text-primary">{s.step}</span>
                <h3 className="mt-2 font-semibold tracking-tight">{t(s.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.body)}</p>
              </li>
            ))}
          </ol>

          {/* Struck through rather than listed plainly: the point is what is
              absent, and a plain list of these words reads like a list of what
              we collect. Every item is a claim `lib/usage.ts` has to keep. */}
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-background/60 p-4">
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("landing.privacy.never")}
            </span>
            {NEVER_RECORDED.map((key) => (
              <span
                key={key}
                className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground line-through decoration-destructive/70"
              >
                {t(key)}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CI -------------------------------------------------------------- */}
      <section id="ci" className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24">
          <div>
            <SectionLabel index={num(privacyIndex + 1)}>{t("landing.label.ci")}</SectionLabel>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("landing.ci.title")}
            </h2>
            <p className="mt-3 max-w-lg text-pretty leading-relaxed text-muted-foreground">
              {t("landing.ci.lead")}
            </p>

            <ul className="mt-8 flex flex-col gap-3">
              {CI_PERKS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                    <Check className="size-2.5" />
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{t(key)}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground">
              {t("landing.ci.badge")}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-mono text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Github className="size-4" />
                {t("landing.ci.repo")}
              </a>
              <a
                href="#checks"
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {t("landing.checks.title", { count: TOTAL_CHECKS })}
                <ArrowRight className="size-3.5" />
              </a>
            </div>
          </div>

          {/* The workflow as it is actually written — the same ref and inputs
              the README documents. A landing page showing a snippet that does
              not resolve is a broken promise a reader finds out about later. */}
          <figure className="overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <figcaption className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span aria-hidden className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-warning/70" />
                <span className="size-2.5 rounded-full bg-primary/70" />
              </span>
              <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                .github/workflows/anti-rot.yml
              </span>
            </figcaption>

            <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed">
              <code>
                <span className="text-muted-foreground">on:</span>{" "}
                <span className="text-foreground">[push, pull_request]</span>
                {"\n\n"}
                <span className="text-muted-foreground">jobs:</span>
                {"\n  "}
                <span className="text-foreground">anti-rot:</span>
                {"\n    "}
                <span className="text-muted-foreground">runs-on:</span>{" "}
                <span className="text-foreground">ubuntu-latest</span>
                {"\n    "}
                <span className="text-muted-foreground">steps:</span>
                {"\n      - "}
                <span className="text-muted-foreground">uses:</span>{" "}
                <span className="text-primary">actions/checkout@v4</span>
                {"\n      - "}
                <span className="text-muted-foreground">uses:</span>{" "}
                <span className="text-primary">YpCIIIaK/repo-janitor@v1</span>
                {"\n        "}
                <span className="text-muted-foreground">with:</span>
                {"\n          "}
                <span className="text-muted-foreground">fail-on:</span>{" "}
                <span style={{ color: GRADE_CSS_VAR.B }}>B</span>
                {"\n          "}
                <span className="text-muted-foreground">sarif-file:</span>{" "}
                <span className="text-foreground">repo-anti-rot.sarif</span>
              </code>
            </pre>

            <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
              <span className="flex overflow-hidden rounded border border-border font-mono text-[11px]">
                <span className="bg-background px-2 py-1 text-muted-foreground">anti-rot</span>
                <span className="bg-primary px-2 py-1 font-semibold text-primary-foreground">
                  A · 93
                </span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {t("landing.ci.badgeNote")}
              </span>
            </div>
          </figure>
        </div>
      </section>
    </>
  )
}
