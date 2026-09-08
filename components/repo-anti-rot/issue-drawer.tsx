"use client"

import { useLocale } from "@/components/i18n/locale-provider"
import { useEffect, useState } from "react"
import { AlertTriangle, Bell, BellOff, Bug, Check, Clipboard, Download, Link2, Loader2, Network, ShieldQuestion, Sparkles } from "lucide-react"
import { Github } from "@/components/icons/github"
import { categoryLabels, severityLabels, type Issue } from "@/lib/mock-data"
import { resolveScanner, scannerLabel } from "@/lib/scanners"
import { fullAge, issueAsMarkdown, severityStyle } from "@/lib/issue-format"
import { falsePositiveUrl } from "@/lib/false-positive"
import { useAiSettings, aiCacheModel } from "@/lib/ai-settings"
import { analyzeOneIssue } from "@/lib/ai-enrich"
import { getCachedNotes, putCachedNotes } from "@/lib/ai-cache"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DependencyResearchGraph, type DependencyResearchGraphProps } from "@/components/repo-anti-rot/dependency-research-graph"

interface Props {
  issue: Issue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  githubUrl: string | null
  /** Prefilled GitHub "new issue" URL for this finding, or null when unavailable. */
  newIssueUrl: string | null
  /**
   * URL of the scanned repository, used to prefill a false-positive report so it
   * arrives with something the rule can be re-run against.
   */
  scannedRepoUrl?: string | null
  scannedCommit?: string | null
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
export function IssueDrawer({
  issue,
  open,
  onOpenChange,
  githubUrl,
  newIssueUrl,
  scannedRepoUrl,
  scannedCommit,
  snoozed,
  onToggleSnooze,
}: Props) {
  const { t, locale } = useLocale()
  const settings = useAiSettings()
  const hasKey = !!settings.apiKey.trim()
  // Cache namespace folds in the web-search toggle (see aiCacheModel).
  const model = aiCacheModel(settings)

  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [research, setResearch] = useState<(DependencyResearchGraphProps & { raw: unknown }) | null>(null)
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)

  // When the selected finding changes, reset to its known/cached verdict.
  useEffect(() => {
    // Intentional re-sync of derived state to the newly selected finding.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null)
    setLoading(false)
    setResearch(null)
    setResearchError(null)
    setResearchLoading(false)
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

  async function investigateDependency() {
    if (!issue?.analysisRef || !scannedRepoUrl) return
    setResearchLoading(true)
    setResearchError(null)
    try {
      const response = await fetch("/api/dependency-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repoUrl: scannedRepoUrl,
          commit: scannedCommit,
          target: `${issue.analysisRef.package}@${issue.analysisRef.version}`,
        }),
      })
      const data = await response.json() as {
        error?: string
        manager?: string
        nodes?: { id: string; kind: "project" | "package"; name: string; version: string | null; runtime: "production" | "development" | "both" | "unknown"; location: string }[]
        edges?: { from: string; to: string; kind: string; requested: string }[]
        paths?: { runtime: "production" | "development"; nodeIds: string[] }[]
        matches?: string[]
        warnings?: string[]
      }
      if (!response.ok || !data.nodes || !data.edges || !data.paths) throw new Error(data.error || "Deep analysis failed")
      const allNodeById = new Map(data.nodes.map((node) => [node.id, node]))
      const projectIds = new Set(data.nodes.filter((node) => node.kind === "project").map((node) => node.id))
      const directIds = new Set(data.edges.filter((edge) => projectIds.has(edge.from)).map((edge) => edge.to))
      const matchIds = new Set(data.matches ?? [])
      const visibleIds = new Set(data.nodes.length <= 300
        ? data.nodes.map((node) => node.id)
        : [...data.paths.flatMap((path) => path.nodeIds), ...(data.matches ?? [])])
      if (data.nodes.length > 300) {
        for (const edge of data.edges) {
          if (visibleIds.size >= 300) break
          if (visibleIds.has(edge.from) || visibleIds.has(edge.to)) {
            visibleIds.add(edge.from)
            if (visibleIds.size < 300) visibleIds.add(edge.to)
          }
        }
      }
      const visibleNodes = [...visibleIds].map((id) => allNodeById.get(id)).filter((node): node is NonNullable<typeof node> => !!node)
      setResearch({
        raw: data,
        nodes: visibleNodes.map((node) => ({
          id: node.id,
          name: node.name,
          version: node.version,
          runtime: node.runtime,
          kind: node.kind === "project" ? (node.location === "." ? "root" : "workspace") : directIds.has(node.id) ? "direct" : "transitive",
          severity: matchIds.has(node.id) ? issue.severity : "none",
          installPath: node.location,
          packageManager: data.manager,
        })),
        edges: data.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).map((edge) => ({ source: edge.from, target: edge.to, label: `${edge.kind} · ${edge.requested}`, optional: edge.kind === "optional" })),
        paths: data.paths.map((path, index) => ({ id: `path-${index}`, nodeIds: path.nodeIds, runtime: path.runtime })),
        summary: {
          title: locale === "ru" ? `Пути к ${issue.analysisRef.package}` : `Paths to ${issue.analysisRef.package}`,
          description: (data.warnings ?? []).length
            ? (locale === "ru" ? `Граф построен с ${data.warnings!.length} предупреждениями о неоднозначных связях.` : `Graph built with ${data.warnings!.length} unresolved-link warnings.`)
            : (locale === "ru" ? "Связи восстановлены из lock-файла; код проекта не запускался." : "Links reconstructed from the lockfile; repository code was not executed."),
          totalNodes: data.nodes.length,
          productionNodes: data.nodes.filter((node) => node.runtime === "production" || node.runtime === "both").length,
          developmentNodes: data.nodes.filter((node) => node.runtime === "development" || node.runtime === "both").length,
          unknownNodes: data.nodes.filter((node) => node.runtime === "unknown").length,
          vulnerableNodes: matchIds.size,
        },
      })
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : "Deep analysis failed")
    } finally {
      setResearchLoading(false)
    }
  }

  function downloadResearch(format: "json" | "md") {
    if (!research) return
    const md = (value: string) => value.replace(/[\\`*_[\]{}()#+.!<>|-]/g, "\\$&")
    const nodeById = new Map(research.nodes.map((node) => [node.id, node]))
    const markdown = [
      `# Dependency research: ${md(issue?.analysisRef?.package ?? "package")}`,
      "",
      research.summary.description ?? "",
      "",
      `- Nodes: ${research.summary.totalNodes}`,
      `- Production: ${research.summary.productionNodes}`,
      `- Development: ${research.summary.developmentNodes}`,
      `- Unknown: ${research.summary.unknownNodes ?? 0}`,
      "",
      "## Paths",
      "",
      ...research.paths.map((path) => `- **${path.runtime}**: ${path.nodeIds.map((id) => {
        const node = nodeById.get(id)
        return md(node ? `${node.name}${node.version ? `@${node.version}` : ""}` : id)
      }).join(" → ")}`),
      "",
    ].join("\n")
    const content = format === "json" ? JSON.stringify(research.raw, null, 2) : markdown
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `dependency-research-${issue?.analysisRef?.package.replace(/[^a-z0-9._-]/gi, "-") ?? "report"}.${format}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const scannerId = issue ? resolveScanner(issue) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("w-full gap-0 overflow-y-auto", research ? "sm:max-w-5xl" : "sm:max-w-md")}>
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
                <dt className="text-muted-foreground">{t("table.category")}</dt>
                <dd className="text-foreground">{categoryLabels[issue.category]}</dd>
                {scannerId && (
                  <>
                    <dt className="text-muted-foreground">{t("table.scanner")}</dt>
                    <dd className="text-foreground">
                      <span>{scannerLabel(scannerId)}</span>
                      <span className="ml-1.5 font-mono text-muted-foreground">{scannerId}</span>
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t("drawer.location")}</dt>
                <dd className="break-all font-mono text-foreground">{issue.location}</dd>
                <dt className="text-muted-foreground">{t("drawer.age")}</dt>
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
                    {t("drawer.ai")}
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
                    {t("drawer.aiNeedsKey")}
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
                    {t("drawer.analyzing")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("drawer.aiHint")}
                  </p>
                )}
              </div>

              {issue.analysisRef && scannedRepoUrl && (
                <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium"><Network className="size-3.5 text-primary" />{locale === "ru" ? "Глубокое исследование зависимости" : "Deep dependency research"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{locale === "ru" ? "Повторно клонирует выбранный commit и восстанавливает полные production/dev пути. Ничего из репозитория не запускается." : "Re-clones the selected commit and reconstructs complete production/dev paths. Repository code is never executed."}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={investigateDependency} disabled={researchLoading}>
                      {researchLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Network className="size-3.5" />}
                      {researchLoading ? (locale === "ru" ? "Исследуем…" : "Researching…") : (locale === "ru" ? "Исследовать пути" : "Research paths")}
                    </Button>
                  </div>
                  {researchError && <p className="text-xs text-destructive">{researchError}</p>}
                  {research && (
                    <>
                      <DependencyResearchGraph {...research} />
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => downloadResearch("json")}><Download className="size-3.5" />JSON</Button>
                        <Button size="sm" variant="ghost" onClick={() => downloadResearch("md")}><Download className="size-3.5" />Markdown</Button>
                      </div>
                    </>
                  )}
                </div>
              )}

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
                      {t("drawer.openGithub")}
                    </a>
                  </Button>
                )}
                {githubUrl && <CopyButton value={githubUrl} label={t("drawer.copyLink")} />}
                {newIssueUrl && (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    title={t("drawer.createIssueHint")}
                  >
                    <a href={newIssueUrl} target="_blank" rel="noopener noreferrer">
                      <Bug className="size-3.5" />
                      {t("drawer.createIssue")}
                    </a>
                  </Button>
                )}
                {/* Points at THIS project, not the scanned repo: the bug being
                    reported is ours. It arrives with the scanner id and a
                    clonable URL already set, which is the difference between a
                    report that can be acted on and one that cannot. */}
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  title={t("drawer.falsePositiveHint")}
                >
                  <a
                    href={falsePositiveUrl({
                      scanner: scannerId,
                      repo: scannedRepoUrl,
                      finding: issue.title,
                      location: issue.location,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ShieldQuestion className="size-3.5" />
                    {t("drawer.falsePositive")}
                  </a>
                </Button>
                <CopyButton value={issueAsMarkdown({ ...issue, aiNote: note ?? issue.aiNote })} label={t("drawer.copyMarkdown")} />
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
                  {t("drawer.noPermalink")}
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
