"use client"

import { useState } from "react"
import { Bell, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale } from "@/components/i18n/locale-provider"
import type { Grade } from "@/lib/mock-data"

type Props = {
  owner: string
  name: string
  repoUrl: string
  grade: Grade
  score: number
  sha?: string | null
  /** Compact single-line variant for share page / share box. */
  compact?: boolean
}

/**
 * Peak-motivation CTA: email me if this grade drops.
 * No account — just a subscription on the repo.
 */
export function WatchBox({
  owner,
  name,
  repoUrl,
  grade,
  score,
  sha,
  compact = false,
}: Props) {
  const { t } = useLocale()
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ managePath: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, owner, name, repoUrl, grade, score, sha: sha ?? undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        managePath?: string
      }
      if (!res.ok) {
        setError(data.error || t("watch.failed"))
        return
      }
      if (!data.managePath) {
        setError(t("watch.failed"))
        return
      }
      setDone({ managePath: data.managePath })
    } catch {
      setError(t("watch.failed"))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <Check className="size-4" />
          {t("watch.success")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("watch.successLead")}</p>
        <a
          href={done.managePath}
          className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
        >
          {t("watch.manageLink")}
        </a>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-2 rounded-lg border border-border bg-card/40 p-3"
    >
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Bell className="size-4 text-muted-foreground" />
          {t("watch.title")}
        </p>
        {!compact && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("watch.lead")}</p>
        )}
      </div>
      <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder={t("watch.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 min-w-0 flex-1 text-sm"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          {t(busy ? "watch.submitting" : "watch.submit")}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}
