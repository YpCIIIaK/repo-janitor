"use client"

import { Activity, Check, ChevronsUpDown, LayoutDashboard, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ReactNode } from "react"
import type { Repository } from "@/lib/mock-data"
import { cn } from "@/lib/utils"
import { useLocale } from "@/components/i18n/locale-provider"

export type TopBarRepoOption = {
  id: string
  owner: string
  name: string
}

export function TopBar({
  repo,
  repos,
  onSelectRepo,
  search = "",
  onSearch,
  onHome,
  onBackToDashboard,
  extras,
}: {
  repo?: Repository
  /** When more than one repo is available, the name becomes a real switcher. */
  repos?: TopBarRepoOption[]
  onSelectRepo?: (id: string) => void
  search?: string
  onSearch?: (value: string) => void
  /** Return to the landing page. Omitted when already there. */
  onHome?: () => void
  /** Leave the landing page for the stored reports. Omitted when there are none. */
  onBackToDashboard?: () => void
  /** Rendered at the right end. Used on the landing page, which has no rail. */
  extras?: ReactNode
}) {
  const { t } = useLocale()
  // The logo is the conventional way home, so it becomes a button wherever
  // there is somewhere to go — and stays plain text where there is not, rather
  // than looking clickable and doing nothing.
  const brand = (
    <>
      <div className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Activity className="size-4" />
      </div>
      <span className="font-mono text-sm font-semibold tracking-tight">Repo Anti-Rot</span>
    </>
  )

  const switchable =
    Boolean(repo && onSelectRepo && repos && repos.length > 1)

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        {onHome ? (
          <button
            onClick={onHome}
            title={t("nav.backHomeLong")}
            aria-label={t("nav.backHome")}
            className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {brand}
          </button>
        ) : (
          <div className="flex items-center gap-2">{brand}</div>
        )}

        {repo && (
          <>
            <span className="text-border">/</span>
            <span className="rounded-md px-2 py-1 text-sm text-muted-foreground">{repo.owner}</span>
            <span className="text-border">/</span>
            {switchable ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("nav.switchRepo")}
                  >
                    {repo.name}
                    <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[12rem]">
                  {repos!.map((r) => {
                    const selected = r.owner === repo.owner && r.name === repo.name
                    return (
                      <DropdownMenuItem
                        key={r.id}
                        onSelect={() => onSelectRepo?.(r.id)}
                        className={cn("gap-2", selected && "font-medium")}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {r.owner}/{r.name}
                        </span>
                        {selected ? <Check className="size-3.5 text-primary" /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="rounded-md px-2 py-1 text-sm font-medium">{repo.name}</span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {onBackToDashboard && (
            <Button variant="ghost" size="sm" onClick={onBackToDashboard}>
              <LayoutDashboard className="size-4" />
              <span className="hidden sm:inline">{t("nav.dashboard")}</span>
            </Button>
          )}
          {/* Only where there are findings to search. The landing page passes no
              handler, and used to get the box anyway — a search field that
              silently does nothing, in the header of the first page a stranger
              sees. */}
          {onSearch && (
            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t("nav.searchIssues")}
                className="h-8 w-56 bg-secondary pl-8 text-sm"
              />
            </div>
          )}
          {/* Settings and "connect a repository" live in the sidebar rail — two
              buttons opening the same dialog is two places to look. Except on
              the landing page, which has no rail: there this is the only way in,
              and Settings is where the operator key is claimed. */}
          {extras}
        </div>
      </div>
    </header>
  )
}
