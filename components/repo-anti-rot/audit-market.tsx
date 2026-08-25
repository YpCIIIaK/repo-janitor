"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { GitBranch, ExternalLink, ShieldCheck, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MarketProgram, MarketSort } from "@/lib/audit/market"

/**
 * The bounty market, ported from the auditscout engine into the Repo Anti-Rot
 * dashboard. Same idea as the CLI's crowdedness ranking — expected pay per
 * submission — but rendered with this app's cards, badges and tokens so it
 * reads as one product with the rot dashboard rather than a bolted-on tool.
 */

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1000)}k` : `$${n}`

function DensityBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  // A quiet three-tier read of pay-per-submission, mirroring the grade tint idea.
  const tier = value >= 5000 ? "high" : value >= 500 ? "mid" : "low"
  return (
    <span
      className={cn(
        "font-mono text-sm font-semibold tabular-nums",
        tier === "high" && "text-emerald-500",
        tier === "mid" && "text-amber-500",
        tier === "low" && "text-muted-foreground",
      )}
      title="Expected reward per submission (fund ÷ historical submissions)"
    >
      {money(value)}
    </span>
  )
}

export function AuditMarket() {
  const [programs, setPrograms] = useState<MarketProgram[]>([])
  const [sites, setSites] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [site, setSite] = useState<string>("all")
  const [sort, setSort] = useState<MarketSort>("density")
  const [reposOnly, setReposOnly] = useState(false)
  const [noKyc, setNoKyc] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    const params = new URLSearchParams()
    if (site !== "all") params.set("site", site)
    params.set("sort", sort)
    if (reposOnly) params.set("repos", "1")
    if (noKyc) params.set("nokyc", "1")
    const ctrl = new AbortController()
    // The loading flag lives inside the async run rather than the effect body, so
    // the first setState is not synchronous with the render (react-hooks/set-state-in-effect).
    const run = async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/audit/market?${params.toString()}`, { signal: ctrl.signal })
        if (!r.ok) throw new Error("Snapshot unavailable")
        const d = await r.json()
        setPrograms(d.programs)
        setSites(d.sites)
        setTotal(d.total)
        setError(null)
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    run()
    return () => ctrl.abort()
  }, [site, sort, reposOnly, noKyc])

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? programs.filter((p) => p.name.toLowerCase().includes(needle)) : programs
  }, [programs, search])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Bounty market</h1>
        <p className="text-sm text-muted-foreground">
          Live audit contests and bounty programs, ranked by expected pay
          per submission — a big fund nobody has looked at beats a bigger fund
          everyone has. Snapshot of {total.toLocaleString()} programs from the
          audit engine.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search program…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full max-w-xs"
        />
        <Select value={site} onValueChange={setSite}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as MarketSort)}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="density">Pay / submission</SelectItem>
            <SelectItem value="reward">Total fund</SelectItem>
            <SelectItem value="reports">Submissions</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={reposOnly ? "default" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => setReposOnly((v) => !v)}
        >
          <GitBranch className="mr-1 size-4" /> Has repo
        </Button>
        <Button
          variant={noKyc ? "default" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => setNoKyc((v) => !v)}
        >
          <ShieldCheck className="mr-1 size-4" /> No KYC
        </Button>
      </div>

      {error && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">{error}</CardContent></Card>
      )}
      {loading && !programs.length && (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading market…</div>
      )}

      <div className="space-y-2">
        {shown.map((p) => (
          <Card key={`${p.site}:${p.pid}`} className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-mono text-[10px]">{p.site}</Badge>
                  {p.kyc && <Badge variant="outline" className="text-[10px]">KYC</Badge>}
                  {p.hasRepos && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <GitBranch className="size-3" /> {p.repos!.length}
                    </Badge>
                  )}
                  {p.reports > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="size-3" /> {p.reports.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-semibold tabular-nums">{money(p.reward)}</div>
                <div className="text-[11px] text-muted-foreground">fund</div>
              </div>
              <div className="w-20 shrink-0 text-right">
                <DensityBadge value={p.perSubmission} />
                <div className="text-[11px] text-muted-foreground">/ submission</div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && !shown.length && !error && (
          <div className="py-12 text-center text-sm text-muted-foreground">No programs match these filters.</div>
        )}
      </div>
    </div>
  )
}
