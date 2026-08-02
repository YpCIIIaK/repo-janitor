"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Copy, Link2, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useLocale } from "@/components/i18n/locale-provider"
import { WidgetCustomize } from "@/components/repo-anti-rot/widget-customize"
import { usageHeaders } from "@/lib/visitor"
import {
  clearShareHandle,
  loadShareHandle,
  repoFromReport,
  saveShareHandle,
  type ShareHandle,
} from "@/lib/share-handle"
import {
  badgeMarkdown,
  badgeUrl,
  cardMarkdown,
  cardUrl,
  embedSnippet,
  embedUrl,
  parseSharePath,
} from "@/lib/badge-markdown"
import {
  cardHeightFor,
  embedDimensions,
  loadWidgetOptions,
  saveWidgetOptions,
  type WidgetOptions,
} from "@/lib/widget-options"
import { cn } from "@/lib/utils"

type CopyTarget = "link" | "card" | "embed" | "badge"
type WidgetTab = "badge" | "card" | "embed"

/**
 * Consent + stable share-link management for a finished scan.
 *
 * One live URL per repository: re-publishing with the manage key (kept in
 * localStorage) refreshes the snapshot so README badges keep working. Revoke
 * deletes the link; rotate mints a new public token when the old URL leaked.
 */
export function ShareBox({ report, repoUrl }: { report: unknown; repoUrl?: string }) {
  const { t } = useLocale()
  const repo = repoFromReport(report)
  const repoKey = repo ? `${repo.owner}/${repo.name}` : ""
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [handle, setHandle] = useState<ShareHandle | null>(() =>
    repo ? loadShareHandle(repo.owner, repo.name) : null,
  )
  const [handleRepoKey, setHandleRepoKey] = useState(repoKey)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopyTarget | null>(null)
  const [status, setStatus] = useState<"idle" | "updated" | "rotated" | "revoked">("idle")
  const [widgetOpts, setWidgetOpts] = useState<WidgetOptions>(() => loadWidgetOptions())
  const [tab, setTab] = useState<WidgetTab>("badge")
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const autoKey = useRef<string | null>(null)

  // Reload the localStorage handle when the scanned repo changes (render-time
  // adjust — avoids a cascading setState-in-effect lint).
  if (repoKey !== handleRepoKey) {
    setHandleRepoKey(repoKey)
    setHandle(repo ? loadShareHandle(repo.owner, repo.name) : null)
  }

  const onWidgetChange = useCallback((next: WidgetOptions) => {
    setWidgetOpts(next)
    saveWidgetOptions(next)
  }, [])

  const persist = useCallback(
    (data: {
      token: string
      manageKey: string
      path: string
      updatedAt: string
      owner: string
      name: string
    }) => {
      const next: ShareHandle = {
        token: data.token,
        manageKey: data.manageKey,
        path: data.path,
        updatedAt: data.updatedAt,
        owner: data.owner,
        name: data.name,
      }
      saveShareHandle(next)
      setHandle(next)
      return next
    },
    [],
  )

  const publish = useCallback(
    async (opts: { manageKey?: string; rotate?: boolean } = {}) => {
      if (!repo) return
      setBusy(true)
      setFailed(null)
      setStatus("idle")
      try {
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "content-type": "application/json", ...usageHeaders() },
          body: JSON.stringify({
            report,
            repoUrl,
            manageKey: opts.manageKey,
            rotate: opts.rotate === true,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          path?: string
          token?: string
          manageKey?: string
          updatedAt?: string
          error?: string
          code?: string
        }
        if (!res.ok) {
          if (data.code === "missing_key") {
            setFailed(t("share.existsOtherDevice"))
          } else {
            setFailed(data.error || t("share.failed"))
          }
          return
        }
        if (!data.path || !data.token || !data.manageKey) throw new Error("incomplete")
        const absolute = new URL(data.path, window.location.origin).toString()
        persist({
          token: data.token,
          manageKey: data.manageKey,
          path: absolute,
          updatedAt: data.updatedAt ?? new Date().toISOString(),
          owner: repo.owner,
          name: repo.name,
        })
        if (opts.rotate) setStatus("rotated")
        else if (opts.manageKey) setStatus("updated")
      } catch {
        setFailed(t("share.failed"))
      } finally {
        setBusy(false)
      }
    },
    [persist, report, repo, repoUrl, t],
  )

  // After a new scan, refresh the published snapshot automatically when this
  // browser still holds the manage key — README URLs stay put.
  useEffect(() => {
    if (!repo || !handle) return
    const generatedAt =
      typeof (report as { generatedAt?: unknown })?.generatedAt === "string"
        ? (report as { generatedAt: string }).generatedAt
        : ""
    const key = `${handle.token}:${generatedAt}`
    if (autoKey.current === key) return
    autoKey.current = key
    if (handle.updatedAt && generatedAt && handle.updatedAt >= generatedAt) return
    const manageKey = handle.manageKey
    // Defer so publish's setState is not synchronous inside the effect body.
    queueMicrotask(() => {
      void publish({ manageKey })
    })
  }, [handle, publish, report, repo])

  async function revoke() {
    if (!repo || !handle) return
    setBusy(true)
    setFailed(null)
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...usageHeaders() },
        body: JSON.stringify({
          token: handle.token,
          manageKey: handle.manageKey,
          owner: repo.owner,
          name: repo.name,
        }),
      })
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setFailed(data.error || t("share.revokeFailed"))
        return
      }
      clearShareHandle(repo.owner, repo.name)
      setHandle(null)
      setConsented(false)
      setStatus("revoked")
    } catch {
      setFailed(t("share.revokeFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function copyText(value: string, which: CopyTarget) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* clipboard blocked — value is on screen */
    }
  }

  if (handle) {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const url = handle.path
    const cacheKey = handle.updatedAt
    const cardMd = cardMarkdown(origin, url, widgetOpts, cacheKey)
    const embedHtml = embedSnippet(origin, url, widgetOpts)
    const badgeMd = badgeMarkdown(origin, url, widgetOpts, cacheKey)
    const target = parseSharePath(url)
    const cardSrc = target ? cardUrl(origin, target, widgetOpts, cacheKey) : ""
    const badgeSrc = target ? badgeUrl(origin, target, widgetOpts, cacheKey) : ""
    const embedSrc = target ? embedUrl(origin, target, widgetOpts) : ""
    const { height: embedH } = embedDimensions(widgetOpts.size)
    const cardH = cardHeightFor(widgetOpts)

    const tabs: { id: WidgetTab; label: string }[] = [
      { id: "badge", label: t("share.tabBadge") },
      { id: "card", label: t("share.tabCard") },
      { id: "embed", label: t("share.tabEmbed") },
    ]

    return (
      <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("share.liveTitle")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("share.liveLead")}</p>
          {status === "updated" && (
            <p className="text-xs text-success">{t("share.updated")}</p>
          )}
          {status === "rotated" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("share.rotated")}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-muted-foreground outline-none"
          />
          <Button size="sm" variant="ghost" onClick={() => copyText(url, "link")}>
            {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {t(copied === "link" ? "share.copied" : "share.copy")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => publish({ manageKey: handle.manageKey })}
          >
            <RefreshCw className="size-4" />
            {t(busy ? "share.updating" : "share.update")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => publish({ manageKey: handle.manageKey, rotate: true })}
          >
            <RotateCcw className="size-4" />
            {t("share.rotate")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revoke()}>
            <Trash2 className="size-4" />
            {t("share.revoke")}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t("share.rotateHint")}</p>
        {failed && <p className="text-xs text-destructive">{failed}</p>}

        <div
          role="tablist"
          aria-label={t("share.widgetsLabel")}
          className="flex gap-1 rounded-md border border-border bg-muted/40 p-0.5"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                tab === item.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Collapsible open={customizeOpen} onOpenChange={setCustomizeOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>{t("share.widgetTitle")}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  customizeOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <WidgetCustomize value={widgetOpts} onChange={onWidgetChange} />
          </CollapsibleContent>
        </Collapsible>

        {tab === "badge" && badgeMd && target && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.badgeTitle")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("share.badgeLead")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={badgeSrc} src={badgeSrc} alt="" className="mt-1 h-5" height={20} />
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {badgeMd}
              </code>
              <Button size="sm" variant="ghost" onClick={() => copyText(badgeMd, "badge")}>
                {copied === "badge" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied === "badge" ? "share.copied" : "share.badgeCopy")}
              </Button>
            </div>
          </div>
        )}

        {tab === "card" && cardMd && target && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.cardTitle")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("share.cardLead")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={cardSrc}
              src={cardSrc}
              alt=""
              className="w-full max-w-[480px] rounded-md border border-border"
              width={480}
              height={cardH}
            />
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {cardMd}
              </code>
              <Button size="sm" variant="ghost" onClick={() => copyText(cardMd, "card")}>
                {copied === "card" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied === "card" ? "share.copied" : "share.cardCopy")}
              </Button>
            </div>
          </div>
        )}

        {tab === "embed" && embedHtml && target && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.embedTitle")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("share.embedLead")}
            </p>
            <iframe
              key={embedSrc}
              src={embedSrc}
              title="Repo Anti-Rot embed preview"
              className="w-full max-w-[420px] rounded-xl border border-border bg-transparent"
              style={{ height: embedH }}
              loading="lazy"
            />
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {embedHtml}
              </code>
              <Button size="sm" variant="ghost" onClick={() => copyText(embedHtml, "embed")}>
                {copied === "embed" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied === "embed" ? "share.copied" : "share.embedCopy")}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      {status === "revoked" && (
        <p className="mb-3 text-xs text-muted-foreground">{t("share.revoked")}</p>
      )}
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          checked={consented}
          onCheckedChange={(v) => setConsented(v === true)}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="text-sm font-medium">{t("consent.label")}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t("consent.body")}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground/70">
            {t("consent.optional")}
          </span>
        </span>
      </label>

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!consented || busy || !repo}
          onClick={() => void publish({})}
        >
          <Link2 className="size-4" />
          {t(busy ? "share.creating" : "share.create")}
        </Button>
        {failed && <span className="text-xs text-destructive">{failed}</span>}
      </div>
    </div>
  )
}
