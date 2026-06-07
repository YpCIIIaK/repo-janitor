"use client"

import { Boxes, FileCode2, Github, Layers, PackageOpen, ScrollText } from "lucide-react"
import type { Grade } from "@/lib/mock-data"
import { languageShares, type RepoProfile } from "@/lib/repo-profile"
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
              <div className="flex flex-wrap gap-1.5">
                {profile.tools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs font-medium"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
