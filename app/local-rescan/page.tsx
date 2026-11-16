import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { localRescanEnabled } from "@/lib/local-rescan-access"
import { LocalRescanDashboard } from "@/components/repo-anti-rot/local-rescan-dashboard"

export const dynamic = "force-dynamic"

export default async function LocalRescanPage() {
  if (!localRescanEnabled(await headers())) notFound()
  return <LocalRescanDashboard />
}
