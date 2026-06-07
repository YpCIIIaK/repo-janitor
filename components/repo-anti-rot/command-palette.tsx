"use client"

import { useEffect } from "react"
import { FileDown, FileJson, FileText, LayoutGrid, ListTree, PlusCircle, Boxes, GitBranch, Workflow, Info } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { downloadReport } from "@/lib/report-export"
import type { ScanReport } from "@/lib/reports-store"
import type { Grade } from "@/lib/mock-data"

export type PaletteTab = "overview" | "issues" | "tree" | "about" | "breakdown"

export interface PaletteRepo {
  id: string
  owner: string
  name: string
  grade: Grade
  score: number
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: PaletteRepo[]
  activeId: string
  onSelectRepo: (id: string) => void
  /** Switch to the cross-repo overview (omitted when there's only one repo). */
  onShowOverview?: () => void
  onNewScan: () => void
  onGoToTab: (tab: PaletteTab) => void
  /** The current repo's report — enables tab navigation and export actions. */
  report?: ScanReport
}

/**
 * ⌘K / Ctrl+K command palette: fast keyboard-driven navigation and actions
 * (switch repos, jump tabs, new scan, export) without reaching for the mouse.
 * Self-contained — owns the global hotkey; the parent only holds open state so a
 * toolbar button can open it too.
 */
export function CommandPalette({
  open,
  onOpenChange,
  repos,
  activeId,
  onSelectRepo,
  onShowOverview,
  onNewScan,
  onGoToTab,
  report,
}: CommandPaletteProps) {
  // Global hotkey: ⌘K (mac) / Ctrl+K (win/linux) toggles the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  /** Run an action and close the palette. */
  const run = (fn: () => void) => () => {
    fn()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search repos, actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {report && (
          <CommandGroup heading="View">
            <CommandItem onSelect={run(() => onGoToTab("overview"))}>
              <LayoutGrid />
              Overview
            </CommandItem>
            <CommandItem onSelect={run(() => onGoToTab("issues"))}>
              <ListTree />
              Issues
            </CommandItem>
            <CommandItem keywords={["tree", "map", "graph", "files"]} onSelect={run(() => onGoToTab("tree"))}>
              <Workflow />
              Tree
            </CommandItem>
            <CommandItem keywords={["about", "profile", "languages", "stack", "tech"]} onSelect={run(() => onGoToTab("about"))}>
              <Info />
              About
            </CommandItem>
            <CommandItem onSelect={run(() => onGoToTab("breakdown"))}>
              <Boxes />
              Breakdown
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(onNewScan)}>
            <PlusCircle />
            New scan…
            <CommandShortcut>add repo</CommandShortcut>
          </CommandItem>
          {report && (
            <>
              <CommandItem
                keywords={["export", "download", "markdown"]}
                onSelect={run(() => downloadReport(report, "md"))}
              >
                <FileText />
                Export as Markdown
              </CommandItem>
              <CommandItem
                keywords={["export", "download", "csv", "spreadsheet"]}
                onSelect={run(() => downloadReport(report, "csv"))}
              >
                <FileDown />
                Export as CSV
              </CommandItem>
              <CommandItem
                keywords={["export", "download", "json", "raw"]}
                onSelect={run(() => downloadReport(report, "json"))}
              >
                <FileJson />
                Export as JSON
              </CommandItem>
            </>
          )}
        </CommandGroup>

        {(repos.length > 0 || onShowOverview) && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Repositories">
              {onShowOverview && (
                <CommandItem keywords={["overview", "portfolio", "all"]} onSelect={run(onShowOverview)}>
                  <Boxes />
                  Portfolio overview
                </CommandItem>
              )}
              {repos.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.owner}/${r.name}`}
                  keywords={[r.owner, r.name]}
                  onSelect={run(() => onSelectRepo(r.id))}
                >
                  <GitBranch />
                  {r.owner}/{r.name}
                  <CommandShortcut>
                    {r.id === activeId ? "current · " : ""}
                    {r.grade} · {r.score}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
