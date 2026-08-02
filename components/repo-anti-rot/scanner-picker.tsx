"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useLocale } from "@/components/i18n/locale-provider"
import { CHECK_FAMILIES } from "@/lib/landing-facts"
import { scannerLabel } from "@/lib/scanners"
import {
  ALL_SCAN_IDS,
  SCAN_PRESETS,
  TOTAL_CHECKS,
} from "@/lib/scan-selection"
import { cn } from "@/lib/utils"

/**
 * Choose which engine scanners run for the next scan.
 * Collapsed by default so the form stays short; presets cover the common case.
 */
export function ScannerPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const set = new Set(selected)
  const count = selected.length
  const allOn = count >= ALL_SCAN_IDS.length

  function toggleOne(id: string, on: boolean) {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    // Never allow an empty selection — empty means “I forgot”, not “run nothing”.
    if (next.size === 0) return
    onChange([...ALL_SCAN_IDS].filter((x) => next.has(x)))
  }

  function toggleFamily(ids: string[], on: boolean) {
    const next = new Set(selected)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    if (next.size === 0) return
    onChange([...ALL_SCAN_IDS].filter((x) => next.has(x)))
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          <span>
            <span className="font-medium text-foreground">{t("scan.checksTitle")}</span>
            <span className="ml-2 text-muted-foreground">
              {allOn
                ? t("scan.checksAll", { total: TOTAL_CHECKS })
                : t("scan.checksPartial", { count, total: TOTAL_CHECKS })}
            </span>
          </span>
          <ChevronDown
            className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("scan.checksLead")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SCAN_PRESETS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={() => onChange(p.ids())}
            >
              {t(p.labelKey)}
            </Button>
          ))}
        </div>
        <div className="max-h-48 space-y-2 overflow-y-auto thin-scrollbar pr-1">
          {CHECK_FAMILIES.map((family) => {
            const onCount = family.scanners.filter((id) => set.has(id)).length
            const familyOn = onCount === family.scanners.length
            const mixed = onCount > 0 && !familyOn
            return (
              <div key={family.id} className="rounded-md border border-border/80 p-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={familyOn ? true : mixed ? "indeterminate" : false}
                    disabled={disabled}
                    onCheckedChange={(v) => toggleFamily(family.scanners, v === true)}
                  />
                  <span className="text-xs font-medium">{t(family.title)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {onCount}/{family.scanners.length}
                  </span>
                </label>
                <div className="mt-1.5 grid gap-1 pl-6 sm:grid-cols-2">
                  {family.scanners.map((id) => (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      <Checkbox
                        checked={set.has(id)}
                        disabled={disabled}
                        onCheckedChange={(v) => toggleOne(id, v === true)}
                      />
                      <span className="truncate" title={id}>
                        {scannerLabel(id)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
