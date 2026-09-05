import { NextResponse } from "next/server"
import { hostedAiEnabled, hostedTriage } from "@/lib/hosted-triage"
import { readJson } from "@/lib/request-json"
import { allowRate } from "@/lib/watch-rate"
import { clientIp, limitsFromEnv } from "@/lib/scan-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ enabled: hostedAiEnabled() }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request) {
  if (!hostedAiEnabled()) return NextResponse.json({ error: "Hosted AI is not configured" }, { status: 503 })
  if (!allowRate(`triage:${clientIp(request, limitsFromEnv().trustedProxyHops)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: "AI request limit reached" }, { status: 429, headers: { "Retry-After": "3600" } })
  }
  let digest: string
  let locale: "en" | "ru" = "en"
  try {
    const body = await readJson(request, 32 * 1024) as { locale?: string; issues?: unknown[] }
    if (!body || !Array.isArray(body.issues) || body.issues.length > 30) throw new Error("Invalid findings")
    locale = body.locale === "ru" ? "ru" : "en"
    const issues = body.issues.map((raw) => {
      const issue = raw as Record<string, unknown>
      if (!issue || typeof issue.title !== "string" || typeof issue.category !== "string" || typeof issue.severity !== "string") throw new Error("Invalid finding")
      if (!["critical", "warning", "info"].includes(issue.severity)) throw new Error("Invalid severity")
      // No evidence, detail, file contents or arbitrary system/prompt fields.
      return { title: issue.scanner === "secrets" ? "Potential committed credential; rotate and investigate" : issue.title.slice(0, 200), category: issue.category.slice(0, 30), severity: issue.severity }
    })
    digest = JSON.stringify({ findings: issues })
  } catch {
    return NextResponse.json({ error: "Invalid or oversized findings" }, { status: 400 })
  }
  try {
    return NextResponse.json({ text: await hostedTriage(digest, locale) }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "AI unavailable or daily allowance reached; the action plan remains available." }, { status: 503 })
  }
}
