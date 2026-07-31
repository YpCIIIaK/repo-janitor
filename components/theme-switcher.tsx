"use client"

import { useEffect, useState } from "react"
import { Check, Palette } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { DEFAULT_THEME, THEMES, type ThemeId, isThemeId } from "@/lib/themes"
import { useLocale } from "@/components/i18n/locale-provider"
import type { MessageKey } from "@/lib/i18n"

const THEME_LABEL_KEY: Record<ThemeId, MessageKey> = {
  moss: "theme.moss",
  ocean: "theme.ocean",
  aurora: "theme.aurora",
}

function ThemeSwatches({ colors }: { colors: readonly [string, string, string] }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-sm border border-border/80" aria-hidden>
      {colors.map((c) => (
        <span key={c} className="size-3.5" style={{ backgroundColor: c }} />
      ))}
    </span>
  )
}

/**
 * Compact colour-theme picker (VS Code–style list with swatches).
 *
 * `variant="rail"` is the square icon used in the dashboard sidebar;
 * the default is a ghost button for headers and the welcome screen.
 */
export function ThemeSwitcher({
  className,
  variant = "default",
}: {
  className?: string
  variant?: "default" | "rail"
}) {
  const { theme, setTheme } = useTheme()
  const { t } = useLocale()
  // Avoid a hydration mismatch: next-themes resolves from localStorage after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current: ThemeId = isThemeId(theme) ? theme : DEFAULT_THEME

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "rail" ? (
          <button
            type="button"
            title={t("theme.label")}
            aria-label={t("theme.label")}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
              className,
            )}
          >
            <Palette className="size-4" />
          </button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={className}
            aria-label={t("theme.label")}
            title={t("theme.label")}
          >
            <Palette className="size-4" />
            <span className="hidden text-xs sm:inline">
              {mounted ? t(THEME_LABEL_KEY[current]) : t("theme.label")}
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {THEMES.map((item) => {
          const selected = mounted && current === item.id
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => setTheme(item.id)}
              className={cn("gap-2", selected && "font-medium")}
            >
              <ThemeSwatches colors={item.swatches} />
              <span className="flex-1">{t(THEME_LABEL_KEY[item.id])}</span>
              {selected ? <Check className="size-3.5 text-primary" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Card grid for Settings — pick a theme by looking at the swatches.
 * English-only: the dashboard Settings surface is not translated.
 */
export function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const current: ThemeId = isThemeId(theme) ? theme : DEFAULT_THEME

  return (
    <div className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {THEMES.map((item) => {
        const selected = mounted && current === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setTheme(item.id)}
            aria-pressed={selected}
            className={cn(
              "flex flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
              selected
                ? "border-primary/40 bg-primary/10"
                : "border-border hover:bg-accent/50",
            )}
          >
            <span className="flex overflow-hidden rounded-sm border border-border/80" aria-hidden>
              {item.swatches.map((c) => (
                <span key={c} className="h-5 flex-1" style={{ backgroundColor: c }} />
              ))}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn("text-xs font-medium", selected && "text-primary")}>
                {item.label}
              </span>
              {selected ? <Check className="size-3 text-primary" /> : null}
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {item.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}
