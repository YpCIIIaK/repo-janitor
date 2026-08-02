"use client"

import { GitCompare, Sparkles } from "lucide-react"
import { useLocale } from "@/components/i18n/locale-provider"
import { COMPARE_PAIR, FAMOUS_REPOS } from "@/lib/famous-repos"
import type { SelectedRepo } from "@/components/repo-anti-rot/repo-picker"
import { cn } from "@/lib/utils"

/**
 * One-tap presets under the scan form — lowers the blank-URL fear.
 */
export function FamousRepos({
  selected,
  onChange,
  disabled,
}: {
  selected: SelectedRepo[]
  onChange: (next: SelectedRepo[]) => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  const selectedUrls = new Set(selected.map((s) => s.url))

  function toggle(url: string) {
    if (selectedUrls.has(url)) {
      onChange(selected.filter((s) => s.url !== url))
      return
    }
    onChange([...selected, { url }])
  }

  function compare() {
    onChange(COMPARE_PAIR.map((r) => ({ url: r.url })))
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 shrink-0" />
        {t("scan.famousLead")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {FAMOUS_REPOS.map((r) => {
          const on = selectedUrls.has(r.url)
          return (
            <button
              key={r.url}
              type="button"
              disabled={disabled}
              onClick={() => toggle(r.url)}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                on
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                disabled && "opacity-50",
              )}
              title={r.url}
            >
              {r.label}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={compare}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground",
            disabled && "opacity-50",
          )}
        >
          <GitCompare className="size-3" />
          {t("scan.famousCompare")}
        </button>
      </div>
    </div>
  )
}
