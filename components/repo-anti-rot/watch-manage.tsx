"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell, ExternalLink, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale } from "@/components/i18n/locale-provider"

export type WatchRow = {
  id: string
  owner: string
  name: string
  repoUrl: string
  lastGrade: string
  lastScore: number
  lastCheckedAt: string | null
  unsubToken: string
}

export function WatchManageList({ initial }: { initial: WatchRow[] }) {
  const { t } = useLocale()
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function unsub(unsubToken: string) {
    setBusy(unsubToken)
    try {
      const res = await fetch("/api/watch", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unsubToken }),
      })
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.unsubToken !== unsubToken))
      }
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("watch.pageEmpty")}</p>
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {r.owner}/{r.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("watch.pageBaseline", { grade: r.lastGrade, score: String(r.lastScore) })}
              {r.lastCheckedAt
                ? ` · ${t("watch.pageLastChecked", {
                    date: new Date(r.lastCheckedAt).toLocaleDateString(),
                  })}`
                : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/?url=${encodeURIComponent(r.repoUrl)}`}>
              <ExternalLink className="size-4" />
              {t("watch.pageScan")}
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy === r.unsubToken}
            onClick={() => void unsub(r.unsubToken)}
          >
            <Trash2 className="size-4" />
            {t("watch.pageUnsub")}
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** Magic-link request form for visitors who lost the manage URL. */
export function WatchMagicForm() {
  const { t } = useLocale()
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await fetch("/api/watch/magic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return <p className="text-sm text-muted-foreground">{t("watch.magicSent")}</p>
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
      <Input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("watch.emailPlaceholder")}
        className="h-8 max-w-xs text-sm"
        disabled={busy}
      />
      <Button type="submit" size="sm" disabled={busy}>
        <Bell className="size-4" />
        {t("watch.magicSubmit")}
      </Button>
    </form>
  )
}
