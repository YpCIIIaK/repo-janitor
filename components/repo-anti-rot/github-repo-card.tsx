"use client"

import { Star, GitFork, CircleDot, Scale, Archive, GitBranch, Plus, Check, HardDrive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { compactCount, type GithubRepo } from "@/lib/github-repo"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * A GitHub repository, as a card.
 *
 * Shown before a scan so the box is not a leap of faith: you can see that the
 * thing you are about to spend a few minutes of cloning on is the project you
 * meant, that it is not archived, and that somebody touched it this decade.
 *
 * No image is loaded. The owner's avatar would mean every visitor's browser
 * fetching from githubusercontent.com — a third-party request, on our page,
 * that we would be making on their behalf without asking. Initials in the
 * owner's own colour carry the same "this is the right project" signal at zero
 * cost to anyone.
 */

/** Colours for the languages this tool actually meets, close to GitHub's own. */
const LANGUAGE_COLOR: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Shell: "#89e051",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  Dart: "#00B4AB",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Lua: "#000080",
  Zig: "#ec915c",
}

/**
 * Size at which a repository is worth a warning, in KB as GitHub reports it.
 *
 * Not a hard limit — the server has its own, and plenty of large repositories
 * scan fine. This is the number that turns "the scan failed after four minutes"
 * into "this one is 500 MB, expect trouble", which is the difference between a
 * bug report and an informed decision.
 */
const LARGE_REPO_KB = 200 * 1024

function formatSize(kb: number): string {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`
}

/** Deterministic tint for the initials tile, so one owner always looks the same. */
function ownerHue(owner: string): number {
  let h = 0
  for (let i = 0; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) % 360
  return h
}

function initials(name: string): string {
  const parts = name.split(/[-_.\s]/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

/** "3 days ago" in the reader's locale, without pulling in a date library. */
function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const seconds = Math.round((then - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ]
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, "minute")
}

function Stat({ icon, value, title }: { icon: React.ReactNode; value: string; title: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" title={title}>
      <span className="[&_svg]:size-3.5">{icon}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )
}

export function GithubRepoCard({
  repo,
  onAdd,
  added,
  compact,
  className,
}: {
  repo: GithubRepo
  /** Shown as an Add button. Omitted for rows that are already chosen. */
  onAdd?: (cloneUrl: string) => void
  /** Already in the selection — the card says so instead of offering to add. */
  added?: boolean
  /** Row density: no topics, no last-push line. */
  compact?: boolean
  className?: string
}) {
  const { t, locale } = useLocale()
  const hue = ownerHue(repo.owner)
  const pushed = relativeTime(repo.pushedAt, locale)

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/60 p-4 transition-colors",
        compact && "p-3",
        compact && !added && "hover:border-primary/40 hover:bg-accent/40",
        added && "border-primary/40 bg-primary/5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
          style={{
            backgroundColor: `hsl(${hue} 45% 22%)`,
            color: `hsl(${hue} 70% 82%)`,
          }}
        >
          {initials(repo.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate font-medium underline-offset-4 hover:underline"
            >
              <span className="text-muted-foreground">{repo.owner}/</span>
              {repo.name}
            </a>
            {repo.archived && (
              <span className="flex items-center gap-1 rounded-full border border-chart-3/40 bg-chart-3/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-chart-3">
                <Archive className="size-3" />
                {t("repo.archived")}
              </span>
            )}
            {repo.sizeKb >= LARGE_REPO_KB && (
              <span
                className="flex items-center gap-1 rounded-full border border-chart-3/40 bg-chart-3/10 px-2 py-0.5 text-[10px] font-medium text-chart-3"
                title={t("repo.largeHint")}
              >
                <HardDrive className="size-3" />
                {formatSize(repo.sizeKb)}
              </span>
            )}
            {repo.fork && (
              <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <GitFork className="size-3" />
                {t("repo.fork")}
              </span>
            )}
          </div>

          {repo.description && (
            <p className={cn("mt-1 text-sm text-muted-foreground", compact ? "line-clamp-1" : "line-clamp-2")}>
              {repo.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {repo.language && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: LANGUAGE_COLOR[repo.language] ?? "#8b949e" }}
                />
                {repo.language}
              </span>
            )}
            <Stat icon={<Star />} value={compactCount(repo.stars)} title={t("repo.stars")} />
            <Stat icon={<GitFork />} value={compactCount(repo.forks)} title={t("repo.forks")} />
            <Stat
              icon={<CircleDot />}
              value={compactCount(repo.openIssues)}
              title={t("repo.openIssues")}
            />
            {repo.license && (
              <Stat icon={<Scale />} value={repo.license} title={t("repo.license")} />
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="size-3.5" />
              {repo.defaultBranch}
            </span>
          </div>

          {!compact && repo.topics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {repo.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>

        {added ? (
          // Stays in place rather than disappearing: in a list of search results
          // the tick is what tells you which ones you already took.
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            <Check className="size-3.5" />
            {t("scan.added")}
          </span>
        ) : (
          onAdd && (
            <Button size="sm" onClick={() => onAdd(repo.cloneUrl)} className="shrink-0">
              <Plus className="size-4" />
              {t("scan.add")}
            </Button>
          )
        )}
      </div>

      {!compact && pushed && (
        // The one number that says whether this project is alive. Kept on its own
        // line rather than lost among the counts, because it is the reason to
        // scan — or not to bother.
        <p className="mt-3 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          {t("repo.lastPush", { when: pushed })}
        </p>
      )}
    </div>
  )
}
