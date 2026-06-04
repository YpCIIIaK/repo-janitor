"use client"

import { ExternalLink, Flame } from "lucide-react"
import type { Issue, Severity } from "@/lib/mock-data"
import { hotspotFiles } from "@/lib/hotspots"
import type { SeverityWeights } from "@/lib/score"
import { githubFileUrl } from "@/lib/github-link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const severityChip: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

interface HotspotRepo {
  url?: string
  commit?: string
  defaultBranch?: string
}

/**
 * "Hotspot files" — files concentrating the most rot, so a fix can be targeted.
 * Hidden entirely when no finding resolves to a concrete file or nothing stacks
 * up on a single file (keeps the dashboard uncluttered for clean repos).
 */
export function HotspotFiles({
  issues,
  weights,
  repo,
}: {
  issues: Issue[]
  weights?: SeverityWeights
  repo?: HotspotRepo
}) {
  const spots = hotspotFiles(issues, weights)
  if (spots.length === 0) return null

  const max = spots[0].weight || 1

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flame className="size-4 text-chart-3" />
          Hotspot files
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {spots.map((s) => {
          const href = repo
            ? githubFileUrl(repo.url, repo.commit, repo.defaultBranch, s.file)
            : null
          return (
            <div key={s.file} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:text-primary"
                    >
                      <span className="truncate">{s.file}</span>
                      <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  ) : (
                    <span className="truncate font-mono text-xs" title={s.file}>
                      {s.file}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {s.issues.length}
                  </span>
                </div>
                {/* relative-weight bar */}
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-chart-3/70"
                    style={{ width: `${Math.max(6, (s.weight / max) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex shrink-0 gap-1 text-[10px]">
                {(["critical", "warning", "info"] as const).map((sev) =>
                  s.counts[sev] > 0 ? (
                    <span
                      key={sev}
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 font-medium tabular-nums",
                        severityChip[sev],
                      )}
                      title={`${s.counts[sev]} ${sev}`}
                    >
                      {s.counts[sev]}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
