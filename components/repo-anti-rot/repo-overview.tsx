"use client"

import { useEffect, useState } from "react"
import {
  Activity,
  Archive,
  Boxes,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardCheck,
  FileCode2,
  GitFork,
  Layers,
  PackageOpen,
  Scale,
  ScrollText,
  Star,
} from "lucide-react"
import { Github } from "@/components/icons/github"
import type { Grade } from "@/lib/mock-data"
import { CHECKLIST_LABELS, TOOL_CHECKS, languageShares, type RepoProfile } from "@/lib/repo-profile"
import { compactCount, type GithubRepo } from "@/lib/github-repo"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Cycling palette for the language bar; "Other" always uses a muted tone.
const LANG_BAR = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary"]
const OTHER_BAR = "bg-muted-foreground/40"
const barColor = (language: string, i: number) => (language === "Other" ? OTHER_BAR : LANG_BAR[i % LANG_BAR.length])

interface OverviewRepo {
  owner: string
  name: string
  url?: string
  defaultBranch?: string
  commit?: string
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

/**
 * "About" tab — what the repository is made of: a language breakdown, the
 * ecosystems/tooling detected from manifests, and a few headline facts. Reads
 * entirely from the report's `profile`; prompts for a rescan on older reports
 * that predate profiling.
 */
export function RepoOverview({
  profile,
  linesOfCode,
  grade,
  score,
  lastScan,
  repo,
}: {
  profile?: RepoProfile
  linesOfCode?: number
  grade: Grade
  score: number
  lastScan: string
  repo: OverviewRepo
}) {
  const repoUrl = repo.url?.replace(/\.git$/, "")

  if (!profile) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <PackageOpen className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No profile yet</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            This report predates repository profiling. Re-scan the repo to see its language breakdown
            and detected tooling here.
          </p>
        </CardContent>
      </Card>
    )
  }

  const { shares } = languageShares(profile.languages)
  const loc = linesOfCode ?? profile.languages.reduce((s, l) => s + l.loc, 0)
  const primary = shares[0]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="size-4 text-muted-foreground" />
              {repo.owner}/{repo.name}
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border px-2 py-0.5 font-medium tabular-nums text-foreground">
                Grade {grade} · {score}
              </span>
              <span className="hidden sm:inline">scanned {lastScan}</span>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Github className="size-3.5" />
                  GitHub
                </a>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<FileCode2 className="size-4" />} label="Files scanned" value={profile.totalFiles.toLocaleString()} />
            <Stat icon={<ScrollText className="size-4" />} label="Lines of code" value={loc.toLocaleString()} />
            <Stat icon={<Layers className="size-4" />} label="Languages" value={String(profile.languages.length)} />
            <Stat icon={<PackageOpen className="size-4" />} label="Tools" value={String(profile.tools.length)} />
          </div>
        </CardContent>
      </Card>

      <GithubFacts owner={repo.owner} name={repo.name} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChecklistCard checklist={profile.checklist} />
        <ActivityCard activity={profile.activity} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Languages */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4 text-muted-foreground" />
              Languages
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recognized source files.</p>
            ) : (
              <>
                {primary && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Mostly <span className="font-medium text-foreground">{primary.language}</span> (
                    {primary.share.toFixed(0)}%)
                  </p>
                )}
                {/* stacked share bar */}
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                  {shares.map((s, i) => (
                    <div
                      key={s.language}
                      className={cn("h-full", barColor(s.language, i))}
                      style={{ width: `${s.share}%` }}
                      title={`${s.language} · ${s.share.toFixed(1)}%`}
                    />
                  ))}
                </div>
                {/* legend */}
                <ul className="mt-3 space-y-1.5">
                  {shares.map((s, i) => (
                    <li key={s.language} className="flex items-center gap-2 text-xs">
                      <span className={cn("size-2.5 shrink-0 rounded-sm", barColor(s.language, i))} />
                      <span className="flex-1 truncate text-foreground">{s.language}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.files} file{s.files === 1 ? "" : "s"}
                      </span>
                      <span className="w-10 text-right font-medium tabular-nums">{s.share.toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tooling */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageOpen className="size-4 text-muted-foreground" />
              Stack &amp; tooling
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile.tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ecosystems detected from manifest files.</p>
            ) : (
              <ul className="space-y-2">
                {profile.tools.map((tool) => (
                  <li key={tool} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 font-medium">
                      {tool}
                    </span>
                    {TOOL_CHECKS[tool] && (
                      <span className="pt-0.5 leading-relaxed text-muted-foreground">{TOOL_CHECKS[tool]}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function relativeDays(iso: string | null | undefined): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return null
  if (days < 1) return "today"
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

/** Live facts from GitHub (cached server-side by /api/github). Hidden for non-GitHub repos or on error. */
function GithubFacts({ owner, name }: { owner: string; name: string }) {
  const [gh, setGh] = useState<GithubRepo | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/github?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { repo?: GithubRepo } | null) => setGh(data?.repo ?? null))
      .catch(() => {})
    return () => controller.abort()
  }, [owner, name])

  if (!gh) return null
  const facts: { icon: React.ReactNode; text: string }[] = [
    { icon: <Star className="size-3.5" />, text: `${compactCount(gh.stars)} stars` },
    { icon: <GitFork className="size-3.5" />, text: `${compactCount(gh.forks)} forks` },
    { icon: <CircleDot className="size-3.5" />, text: `${compactCount(gh.openIssues)} open issues & PRs` },
    { icon: <Scale className="size-3.5" />, text: gh.license ?? "No license" },
  ]
  const pushed = relativeDays(gh.pushedAt)
  const created = gh.createdAt ? new Date(gh.createdAt).getFullYear() : null

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {gh.archived && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Archive className="size-3.5" /> Archived on GitHub — read-only, no longer maintained
          </p>
        )}
        {gh.description && <p className="text-sm leading-relaxed">{gh.description}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {facts.map((f) => (
            <span key={f.text} className="flex items-center gap-1.5">
              {f.icon}
              {f.text}
            </span>
          ))}
          {pushed && <span>Last push {pushed}</span>}
          {created && <span>Since {created}</span>}
        </div>
        {gh.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {gh.topics.slice(0, 12).map((topic) => (
              <span key={topic} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {topic}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChecklistCard({ checklist }: { checklist?: Record<string, boolean> }) {
  const items = Object.keys(CHECKLIST_LABELS)
  const have = checklist ? items.filter((k) => checklist[k]).length : 0
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          Project essentials
          {checklist && (
            <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
              {have}/{items.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!checklist ? (
          <p className="text-sm text-muted-foreground">Rescan to see which essentials this repository has.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((k) => (
              <li key={k} className="flex items-start gap-2 text-xs">
                {checklist[k] ? (
                  <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-px size-3.5 shrink-0 text-muted-foreground/50" />
                )}
                <span className={cn("font-medium", !checklist[k] && "text-muted-foreground")}>
                  {CHECKLIST_LABELS[k].label}
                </span>
                <span className="text-muted-foreground">— {CHECKLIST_LABELS[k].why}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityCard({ activity }: { activity?: RepoProfile["activity"] }) {
  const max = Math.max(1, ...(activity?.months.map((m) => m.commits) ?? [0]))
  const last = relativeDays(activity?.lastCommitAt)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-muted-foreground" />
          Activity, last 12 months
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!activity ? (
          <p className="text-sm text-muted-foreground">
            Needs the full git history. Rescan with full history to see commits and contributors.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat icon={<ScrollText className="size-4" />} label="Commits" value={activity.commitsLastYear.toLocaleString()} />
              <Stat icon={<Boxes className="size-4" />} label="Authors" value={String(activity.authors)} />
              <Stat icon={<Layers className="size-4" />} label="Make 80% of commits" value={String(activity.coreAuthors)} />
            </div>
            <div>
              <div className="flex h-16 items-end gap-1">
                {activity.months.map((m) => (
                  <div
                    key={m.month}
                    title={`${m.month}: ${m.commits} commits`}
                    className={cn("flex-1 rounded-sm", m.commits ? "bg-chart-1" : "bg-secondary")}
                    style={{ height: `${Math.max(6, (m.commits / max) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{activity.months[0]?.month}</span>
                <span>{activity.months[activity.months.length - 1]?.month}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {last && <>Last commit {last}. </>}
              {activity.coreAuthors === 1 && activity.commitsLastYear > 0
                ? "One person carries most of the work — a bus-factor risk."
                : null}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
