"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { downloadReport, type ExportFormat } from "@/lib/report-export"
import type { ScanReport } from "@/lib/reports-store"

const OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "md", label: "Markdown", hint: "Grouped report for PRs & docs" },
  { format: "csv", label: "CSV", hint: "One row per finding (spreadsheet)" },
  { format: "json", label: "JSON", hint: "Raw report (full schema)" },
]

/** Export the current repo's stored scan report as Markdown / CSV / JSON. */
export function ExportMenu({ report, className }: { report: ScanReport; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={className} title="Export this report">
          <Download className="size-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export report</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.format} onSelect={() => downloadReport(report, o.format)}>
            <div className="flex flex-col">
              <span className="text-sm">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
