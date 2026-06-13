"use client"

import { useEffect, useState } from "react"
import { Sparkles, Loader2, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react"
import type { Issue } from "@/lib/mock-data"
import type { SeverityWeights } from "@/lib/score"
import { useAiSettings, aiCacheModel } from "@/lib/ai-settings"
import { generateSummary, getCachedSummary, type SummaryInput } from "@/lib/ai-summary"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const COLLAPSE_KEY = "repo-anti-rot:ai-summary-collapsed:v1"

interface Props {
  repoId: string
  owner: string
  name: string
  issues: Issue[]
  weights?: SeverityWeights
}

/**
 * On-demand AI executive summary for the whole repo. Shows a cached summary
 * instantly when the finding set is unchanged; otherwise the user clicks Generate
 * to spend exactly one cheap model call. Gracefully degrades to a hint when no AI
 * key is configured.
 */
export function AiSummaryCard({ repoId, owner, name, issues, weights }: Props) {
  const settings = useAiSettings()
  const hasKey = !!settings.apiKey.trim()
  // Cache namespace folds in the web-search toggle (see aiCacheModel).
  const model = aiCacheModel(settings)

  const [summary, setSummary] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Restore the collapsed preference after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      // Post-mount read of a client-only value — intentionally deferred to avoid an
      // SSR hydration mismatch; the synchronous setState here is the point.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1")
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        /* ignore unavailable storage */
      }
      return next
    })
  }

  // Reset to the cached summary whenever the repo, model, or finding set changes.
  const idsKey = issues.map((i) => i.id).join(",")
  useEffect(() => {
    // Resetting derived state when the repo/model/finding set changes is the intended
    // behavior here; this effect re-syncs the view to the cached summary on those keys.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    if (!hasKey) {
      setSummary(null)
      return
    }
    const hit = getCachedSummary(model, repoId, issues.map((i) => i.id))
    setSummary(hit)
    setCached(!!hit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, model, idsKey, hasKey])

  const input: SummaryInput = { repoId, owner, name, issues, weights }

  async function run(force: boolean) {
    setLoading(true)
    setError(null)
    try {
      const res = await generateSummary(input, { force })
      if (res) {
        setSummary(res.summary)
        setCached(res.cached)
      } else {
        setError("Could not generate a summary (model unavailable or rate-limited). Try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Executive summary
        </CardTitle>
        <div className="flex items-center gap-1">
          {hasKey &&
            (summary ? (
              <Button variant="ghost" size="sm" onClick={() => run(true)} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Regenerate
              </Button>
            ) : (
              <Button size="sm" onClick={() => run(false)} disabled={loading || issues.length === 0}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Generate
              </Button>
            ))}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand executive summary" : "Collapse executive summary"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
      <CardContent className="text-sm">
        {!hasKey ? (
          <p className="text-muted-foreground">
            Add an OpenRouter key in <span className="font-medium text-foreground">Settings</span> to
            generate a one-paragraph health summary for this repo.
          </p>
        ) : loading && !summary ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Analyzing {issues.length} finding{issues.length === 1 ? "" : "s"}…
          </p>
        ) : error ? (
          <p className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : summary ? (
          <div className="space-y-2">
            <p className="leading-relaxed text-foreground/90">{summary}</p>
            <p className="text-[11px] text-muted-foreground">
              {cached ? "Cached · " : "Fresh · "}
              {model}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            {issues.length === 0
              ? "No open issues — nothing to summarize."
              : "Click Generate for a one-paragraph verdict on this repo's health."}
          </p>
        )}
      </CardContent>
      )}
    </Card>
  )
}
