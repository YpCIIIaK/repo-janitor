import { NextResponse } from "next/server"
import { PROOF_REPOS, type ProofSnapshot, type ProofSnapshotEntry } from "@/lib/proof-repos"
import snapshot from "@/lib/proof-snapshot.json"
import { readServerRepos } from "@/lib/server-store"
import type { Grade } from "@/lib/mock-data"

/**
 * Grades for the landing proof strip.
 *
 * Prefer a CI-ingested report when one exists; otherwise fall back to the
 * committed snapshot so the strip is never empty on a cold deploy.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type ProofRow = ProofSnapshotEntry & {
  label: string
  url: string
  source: "live" | "snapshot"
}

export async function GET() {
  const snap = snapshot as ProofSnapshot
  const byId = new Map(
    snap.repos.map((r) => [`${r.owner}/${r.name}`.toLowerCase(), r] as const),
  )

  let live: Awaited<ReturnType<typeof readServerRepos>> = []
  try {
    live = await readServerRepos()
  } catch {
    live = []
  }
  const liveById = new Map(live.map((r) => [r.id.toLowerCase(), r] as const))

  const repos: ProofRow[] = PROOF_REPOS.map((p) => {
    const id = `${p.owner}/${p.name}`.toLowerCase()
    const ingested = liveById.get(id)
    if (ingested?.latest) {
      return {
        owner: p.owner,
        name: p.name,
        label: p.label,
        url: p.url,
        grade: ingested.latest.grade as Grade,
        score: ingested.latest.score,
        source: "live" as const,
      }
    }
    const cached = byId.get(id)
    return {
      owner: p.owner,
      name: p.name,
      label: p.label,
      url: p.url,
      grade: (cached?.grade ?? "C") as Grade,
      score: cached?.score ?? 70,
      source: "snapshot" as const,
    }
  })

  return NextResponse.json(
    { updatedAt: snap.updatedAt, repos },
    {
      headers: {
        // Short CDN/browser cache — live ingest should show up soon.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  )
}
