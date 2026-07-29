"use client"

import { useMemo } from "react"
import { ShieldCheck, LinkIcon, CheckCircle2 } from "lucide-react"
import type { Issue } from "@/lib/mock-data"
import { filterMode, type IssueMode } from "@/lib/issue-modes"
import { severityStyle } from "@/lib/issue-format"
import { useSnoozed, partitionSnoozed } from "@/lib/snooze-store"
import type { SeverityWeights } from "@/lib/score"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { IssuesTable, type TableRepo } from "./issues-table"
import { cn } from "@/lib/utils"

interface ModeCopy {
  icon: typeof ShieldCheck
  title: string
  lead: string
  /** Shown when the mode has no findings — says what was checked, not just "none". */
  clean: string
}

const COPY: Record<IssueMode, ModeCopy> = {
  security: {
    icon: ShieldCheck,
    title: "Security",
    lead: "Everything that could get this repository owned: dangerous code, committed secrets, and dependencies with known advisories.",
    clean:
      "No secrets in the working tree or history, no advisories against your dependencies, and no dangerous constructs in your source.",
  },
  links: {
    icon: LinkIcon,
    title: "Links",
    lead: "Link rot, inside and out: relative paths that no longer resolve, and external URLs that are gone.",
    clean:
      "Every relative link resolves to a file that exists, and every external link this repo publishes still answers.",
  },
}

/**
 * A focused view of one kind of finding.
 *
 * The full Issues table stays the place to see everything at once; a mode
 * answers a single question, so it leads with the count that answers it and
 * reuses the same table underneath rather than inventing a second way to read a
 * finding. Sharing the table also means snoozing, grouping, the drawer and the
 * GitHub links all keep working here for free.
 */
export function ModePanel({
  mode,
  issues,
  repo,
  query,
  weights,
}: {
  mode: IssueMode
  issues: Issue[]
  repo?: TableRepo
  query?: string
  weights?: SeverityWeights
}) {
  const copy = COPY[mode]
  const scoped = useMemo(() => filterMode(issues, mode), [issues, mode])

  // The table takes the unfiltered set so its own "show snoozed" toggle still
  // works; the headline counts must exclude snoozed findings, or this number
  // disagrees with the badge on the tab that brought you here.
  const snoozed = useSnoozed()
  const live = useMemo(
    () => partitionSnoozed(repo?.id ?? "", scoped, snoozed).live,
    [repo?.id, scoped, snoozed],
  )

  const counts = useMemo(
    () => ({
      critical: live.filter((i) => i.severity === "critical").length,
      warning: live.filter((i) => i.severity === "warning").length,
      info: live.filter((i) => i.severity === "info").length,
    }),
    [live],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <copy.icon className="size-4 text-primary" />
            {copy.title}
          </CardTitle>
          <CardDescription className="max-w-2xl text-pretty">{copy.lead}</CardDescription>
        </CardHeader>
        <CardContent>
          {live.length === 0 ? (
            // Says what was checked, so "nothing here" reads as a result rather
            // than as a scanner that failed to run.
            <EmptyState
              icon={<CheckCircle2 className="text-success" />}
              title={`${copy.title}: all clear`}
              description={copy.clean}
              className="border-success/25 bg-success/5"
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums">{live.length}</span>
              <span className="mr-2 text-sm text-muted-foreground">
                finding{live.length === 1 ? "" : "s"}
              </span>
              {(["critical", "warning", "info"] as const)
                .filter((s) => counts[s] > 0)
                .map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                      severityStyle[s],
                    )}
                  >
                    {counts[s]} {s}
                  </span>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {scoped.length > 0 && (
        <IssuesTable issues={scoped} repo={repo} query={query} weights={weights} />
      )}
      {scoped.length > 0 && live.length === 0 && (
        <p className="text-xs text-muted-foreground">
          All {scoped.length} finding{scoped.length === 1 ? " is" : "s are"} snoozed — use the list
          options above to show them.
        </p>
      )}
    </div>
  )
}
