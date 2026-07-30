"use client"

import { useRouter } from "next/navigation"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { WelcomeScreen } from "@/components/repo-anti-rot/welcome-screen"
import { SettingsDialog } from "@/components/repo-anti-rot/settings-dialog"
import { useRepos } from "@/lib/reports-store"

/**
 * The front door: one input field, nothing else.
 *
 * This page and the dashboard used to be the same component, switching on
 * whether any report existed. That made the landing page unreachable the moment
 * you scanned anything — and worse, it swapped itself out mid-flow: the scan
 * finished, the results rendered, the store updated, and the same render pass
 * replaced the whole screen with the dashboard before you could read them.
 *
 * Splitting them on the router settles it. `/` is for someone who has never been
 * here and wants to look at a repository; `/app` is for someone with reports to
 * come back to. Neither can displace the other by accident, and the landing page
 * stays a page a stranger can be linked to.
 */
export default function LandingPage() {
  const router = useRouter()
  const repos = useRepos()

  return (
    <div className="min-h-screen">
      {/* Only offered once there is something to go back to. Before the first
          scan the dashboard is an empty room. */}
      <TopBar
        onBackToDashboard={repos.length > 0 ? () => router.push("/app") : undefined}
        extras={<SettingsDialog />}
      />
      <WelcomeScreen />
    </div>
  )
}
