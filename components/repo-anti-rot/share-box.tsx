"use client"

import { useState } from "react"
import { Check, Copy, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useLocale } from "@/components/i18n/locale-provider"
import { usageHeaders } from "@/lib/visitor"
import { badgeMarkdown, badgeUrl, parseSharePath } from "@/lib/badge-markdown"

/**
 * Consent + share-link creation for a finished scan.
 *
 * The checkbox is unticked by default and nothing is sent until it is ticked and
 * the button pressed: publishing is an action the user takes, not a default they
 * have to notice and undo.
 *
 * The full report is POSTed and reduced server-side (lib/share-report.ts). The
 * wording next to the checkbox describes that reduction exactly — if one
 * changes, so does the other.
 */
export function ShareBox({ report, repoUrl }: { report: unknown; repoUrl?: string }) {
  const { t } = useLocale()
  const [consented, setConsented] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Which value was copied last, so the two buttons confirm independently
  // rather than both flipping to "Copied" when either is pressed.
  const [copied, setCopied] = useState<"link" | "badge" | null>(null)

  async function createLink() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json", ...usageHeaders() },
        body: JSON.stringify({ report, repoUrl }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { path?: string }
      if (!data.path) throw new Error("no path")
      setUrl(new URL(data.path, window.location.origin).toString())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function copyText(value: string, which: "link" | "badge") {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* clipboard blocked — the value is on screen and selectable anyway */
    }
  }

  if (url) {
    const origin = window.location.origin
    const markdown = badgeMarkdown(origin, url)
    const target = parseSharePath(url)

    return (
      <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
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

        {/* The other half of the point. A shared report says "here is what I
            found"; the badge is how someone whose repository came out well gets
            to say so, in the place people actually look. */}
        {markdown && target && (
          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium">{t("share.badgeTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("share.badgeLead")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={badgeUrl(origin, target)}
              alt=""
              className="mt-2 h-5"
              width={120}
              height={20}
            />
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {markdown}
              </code>
              <Button size="sm" variant="ghost" onClick={() => copyText(markdown, "badge")}>
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
        <Button size="sm" disabled={!consented || busy} onClick={createLink}>
          <Link2 className="size-4" />
          {t(busy ? "share.creating" : "share.create")}
        </Button>
        {failed && <span className="text-xs text-red-500">{t("share.failed")}</span>}
      </div>
    </div>
  )
}
