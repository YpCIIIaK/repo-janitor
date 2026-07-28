"use client"

import * as React from "react"
import { Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/ui/empty-state.tsx).
 * Copied verbatim apart from the `cn` import path — this project keeps it in
 * `lib/utils`, the kit in `lib/cn`. Keep the two in sync by hand: the kit is a
 * copy-paste library, not a package.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground [&_svg]:size-6">
        {icon ?? <Inbox />}
      </span>
      <div>
        <div className="text-base font-semibold">{title}</div>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
