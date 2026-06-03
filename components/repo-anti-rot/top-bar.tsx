"use client"

import { Activity, ChevronsUpDown, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { OnboardingDialog } from "./onboarding-dialog"
import { SettingsDialog } from "./settings-dialog"
import type { Repository } from "@/lib/mock-data"

export function TopBar({
  repo,
  search = "",
  onSearch,
}: {
  repo?: Repository
  search?: string
  onSearch?: (value: string) => void
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Activity className="size-4" />
          </div>
          <span className="font-mono text-sm font-semibold tracking-tight">Repo Anti-Rot</span>
        </div>

        {repo && (
          <>
            <span className="text-border">/</span>
            <span className="rounded-md px-2 py-1 text-sm text-muted-foreground">{repo.owner}</span>
            <span className="text-border">/</span>
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-accent">
              {repo.name}
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearch?.(e.target.value)}
              placeholder="Search issues..."
              className="h-8 w-56 bg-secondary pl-8 text-sm"
            />
          </div>
          <SettingsDialog />
          <OnboardingDialog />
        </div>
      </div>
    </header>
  )
}
