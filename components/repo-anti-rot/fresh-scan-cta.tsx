"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * Invitation to re-run the scan on a shared report.
 *
 * A shared page shows numbers from the day it was published — sometimes months
 * ago — and a reader has no way to tell whether they still hold. This offers the
 * obvious next step, which is also the moment someone is most likely to try the
 * tool: they are already looking at its output and wondering if it is current.
 *
 * The link is a plain anchor and renders immediately, so the page stays useful
 * with JavaScript disabled and without waiting on a third-party host. The
 * liveness check then runs in the background and *demotes* the offer if the
 * repository can no longer be cloned. Never the other way around: an offer that
 * only appears after a network round trip is an offer most readers never see.
 */
export function FreshScanCta({ repoUrl, repoLabel }: { repoUrl: string; repoLabel: string }) {
  const { t } = useLocale()
  const [state, setState] = useState<"checking" | "live" | "gone">("checking")

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    fetch("/api/repo-live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: repoUrl }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ live?: boolean }>) : null))
      .then((d) => {
        if (cancelled) return
        // A failed check is not evidence the repo is gone — our own network
        // hiccup should not accuse someone else's repository of being deleted.
        setState(d?.live === false ? "gone" : "live")
      })
      .catch(() => {
        if (!cancelled) setState("live")
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [repoUrl])

  if (state === "gone") {
    return (
      <div className="mt-10 rounded-xl border border-border bg-card/40 p-5">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-chart-3" />
          {t("share.gone")}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10 rounded-xl border border-primary/20 bg-primary/5 p-5">
      <p className="text-base font-semibold">{t("share.freshTitle")}</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("share.freshLead")}</p>
      <div className="mt-4 flex items-center gap-3">
        <Button asChild>
          <Link href={`/?url=${encodeURIComponent(repoUrl)}`}>
            {t("share.freshAction", { repo: repoLabel })}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        {state === "checking" && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("share.checking")}
          </span>
        )}
      </div>
    </div>
  )
}
