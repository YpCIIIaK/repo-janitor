import type { Metadata } from "next"
import Link from "next/link"
import { AuditMarket } from "@/components/repo-anti-rot/audit-market"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Bounty market — Repo Anti-Rot",
  robots: { index: false, follow: false },
}

/**
 * The audit-market section — the first mechanic ported from the auditscout
 * engine. It reuses this app's shell and design tokens so it lands as a native
 * part of the dashboard rather than a second product wearing a different skin.
 */
export default function AuditPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
          <Link href="/app" className="font-mono text-sm font-semibold tracking-tight hover:underline">
            Repo Anti-Rot
          </Link>
          <span className="text-border">/</span>
          <span className="text-sm text-muted-foreground">Audit</span>
        </div>
      </header>
      <AuditMarket />
    </main>
  )
}
