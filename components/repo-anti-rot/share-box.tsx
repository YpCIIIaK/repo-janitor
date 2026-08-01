"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy, Link2, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useLocale } from "@/components/i18n/locale-provider"
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

type CopyTarget = "link" | "card" | "embed" | "badge"

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
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [handle, setHandle] = useState<ShareHandle | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopyTarget | null>(null)
  const [status, setStatus] = useState<"idle" | "updated" | "revoked">("idle")
  const autoKey = useRef<string | null>(null)

  useEffect(() => {
    if (!repo) return
    setHandle(loadShareHandle(repo.owner, repo.name))
  }, [repo?.owner, repo?.name])

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
        if (opts.manageKey && !opts.rotate) setStatus("updated")
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
    void publish({ manageKey: handle.manageKey })
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
    const cardMd = cardMarkdown(origin, url)
    const embedHtml = embedSnippet(origin, url)
    const badgeMd = badgeMarkdown(origin, url)
    const target = parseSharePath(url)

    return (
      <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("share.liveTitle")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("share.liveLead")}</p>
          {status === "updated" && (
            <p className="text-xs text-success">{t("share.updated")}</p>
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

        {cardMd && target && (
          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.cardTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("share.cardLead")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${cardUrl(origin, target)}${handle.updatedAt ? `&t=${encodeURIComponent(handle.updatedAt)}` : ""}`}
              alt=""
              className="mt-2 w-full max-w-[480px] rounded-md border border-border"
              width={480}
              height={196}
            />
            <div className="mt-2 flex items-center gap-2">
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

        {embedHtml && target && (
          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.embedTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("share.embedLead")}
            </p>
            <iframe
              src={embedUrl(origin, target)}
              title="Repo Anti-Rot embed preview"
              className="mt-2 w-full rounded-xl border border-border bg-transparent"
              style={{ height: 200 }}
              loading="lazy"
            />
            <div className="mt-2 flex items-center gap-2">
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

        {badgeMd && target && (
          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.badgeTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("share.badgeLead")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${badgeUrl(origin, target)}${handle.updatedAt ? `&t=${encodeURIComponent(handle.updatedAt)}` : ""}`}
              alt=""
              className="mt-2 h-5"
              width={120}
              height={20}
            />
            <div className="mt-2 flex items-center gap-2">
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
