"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Bell, BellOff, Bug, Check, Clipboard, Github, Link2, Loader2, Sparkles } from "lucide-react"
import { categoryLabels, severityLabels, type Issue } from "@/lib/mock-data"
import { fullAge, issueAsMarkdown, severityStyle } from "@/lib/issue-format"
import { useAiSettings } from "@/lib/ai-settings"
import { analyzeOneIssue } from "@/lib/ai-enrich"
import { getCachedNotes, putCachedNotes } from "@/lib/ai-cache"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface Props {
  issue: Issue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  githubUrl: string | null
  /** Prefilled GitHub "new issue" URL for this finding, or null when unavailable. */
  newIssueUrl: string | null
  snoozed: boolean
  onToggleSnooze: () => void
}

/** A copy-to-clipboard button that flips to a check briefly. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard blocked — ignore */
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-primary" /> : <Clipboard className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  )
}

/**
 * Sliding detail panel for a single finding: full metadata, evidence, an
 * on-demand AI verdict, and quick actions (GitHub permalink, copy, snooze).
 */
export function IssueDrawer({ issue, open, onOpenChange, githubUrl, newIssueUrl, snoozed, onToggleSnooze }: Props) {
  const settings = useAiSettings()
  const hasKey = !!settings.apiKey.trim()
  const model = settings.model

  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // When the selected finding changes, reset to its known/cached verdict.
  useEffect(() => {
    setError(null)
    setLoading(false)
    if (!issue) {
      setNote(null)
      return
    }
    const cached = hasKey ? getCachedNotes(model, [issue.id]).get(issue.id) : undefined
    setNote(issue.aiNote ?? cached ?? null)
  }, [issue, model, hasKey])

  async function generate() {
    if (!issue) return
    setLoading(true)
    setError(null)
    try {
      const verdict = await analyzeOneIssue(issue, settings)
      if (verdict) {
        setNote(verdict)
        putCachedNotes(model, [[issue.id, verdict]])
      } else {
        setError("Could not generate a verdict (model unavailable or rate-limited). Try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {issue && (
          <>
            <SheetHeader className="space-y-2 border-b border-border">
              <span
                className={cn(
                  "inline-block w-fit rounded-full border px-2 py-0.5 text-xs font-medium",
                  severityStyle[issue.severity],
                )}
              >
                {severityLabels[issue.severity]}
              </span>
              <SheetTitle className="text-base leading-snug">{issue.title}</SheetTitle>
            </SheetHeader>

            <div className="space-y-4 p-4">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Category</dt>
                <dd className="text-foreground">{categoryLabels[issue.category]}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="break-all font-mono text-foreground">{issue.location}</dd>
                <dt className="text-muted-foreground">Age</dt>
                <dd className="text-foreground">{fullAge(issue.ageDays)}</dd>
              </dl>

              {issue.evidence && (
                <pre className="overflow-x-auto rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
                  <code>{issue.evidence}</code>
                </pre>
              )}

              <p className="text-sm leading-relaxed text-foreground/90">{issue.detail}</p>

              {/* AI verdict */}
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Sparkles className="size-3.5" />
                    AI analysis
                  </div>
                  {hasKey && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2 text-xs"
                      onClick={generate}
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {note ? "Regenerate" : "Generate"}
                    </Button>
                  )}
                </div>
                {!hasKey ? (
                  <p className="text-xs text-muted-foreground">
                    Add an OpenRouter key in Settings to get a verdict for this finding.
                  </p>
                ) : error ? (
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {error}
                  </p>
                ) : note ? (
                  <p className="text-sm leading-relaxed text-foreground/90">{note}</p>
                ) : loading ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Analyzing…
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click Generate for a decisive verdict on this finding.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-1 border-t border-border pt-3">
                {githubUrl && (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                      <Github className="size-3.5" />
                      Open on GitHub
                    </a>
                  </Button>
                )}
                {githubUrl && <CopyButton value={githubUrl} label="Copy link" />}
                {newIssueUrl && (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    title="Open GitHub's new-issue form, prefilled — you review and submit it there"
                  >
                    <a href={newIssueUrl} target="_blank" rel="noopener noreferrer">
                      <Bug className="size-3.5" />
                      Create issue
                    </a>
                  </Button>
                )}
                <CopyButton value={issueAsMarkdown({ ...issue, aiNote: note ?? issue.aiNote })} label="Copy Markdown" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onToggleSnooze}
                >
                  {snoozed ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
                  {snoozed ? "Unsnooze" : "Snooze"}
                </Button>
              </div>
              {githubUrl === null && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Link2 className="size-3" />
                  No GitHub permalink for this location.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
