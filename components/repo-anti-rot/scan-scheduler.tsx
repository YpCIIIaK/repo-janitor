"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useRepos } from "@/lib/reports-store"
import { dueRepos, useSchedule, type ScheduleSettings } from "@/lib/schedule-store"
import { rescanRepo } from "@/lib/rescan"
import type { StoredRepo } from "@/lib/reports-store"

/**
 * Headless background scheduler.
 *
 * While the dashboard is open, it checks once a minute whether any tracked repo
 * is due for a re-scan (per the user's schedule) and runs the due ones
 * sequentially, reusing the same pipeline as the manual Rescan button. Renders
 * nothing; surfaces activity via toasts.
 *
 * Limitation by design: this only runs while a tab is open. For truly unattended
 * scheduling, use the GitHub Action's `schedule:` trigger.
 */

const CHECK_INTERVAL_MS = 60_000 // re-evaluate the schedule every minute

// Module-level guard so overlapping ticks (or multiple mounts) never run scans
// concurrently within a tab.
let running = false

export function ScanScheduler() {
  const repos = useRepos()
  const schedule = useSchedule()

  // Keep the latest values reachable from the interval closure without resetting
  // the timer on every store change. Refs are written in an effect (not during
  // render) so render stays pure.
  const reposRef = useRef<StoredRepo[]>(repos)
  const scheduleRef = useRef<ScheduleSettings>(schedule)
  useEffect(() => {
    reposRef.current = repos
    scheduleRef.current = schedule
  }, [repos, schedule])

  useEffect(() => {
    async function tick() {
      if (running) return
      const settings = scheduleRef.current
      if (!settings.enabled) return
      const due = dueRepos(settings, reposRef.current)
      if (due.length === 0) return

      running = true
      const t = toast.loading(
        `Scheduled scan: ${due.length} repo${due.length === 1 ? "" : "s"}…`,
      )
      let ok = 0
      const failed: string[] = []
      try {
        for (const repo of due) {
          try {
            await rescanRepo(repo)
            ok++
          } catch {
            failed.push(repo.name)
          }
        }
      } finally {
        running = false
      }

      if (failed.length === 0) {
        toast.success(`Scheduled scan complete — ${ok} repo${ok === 1 ? "" : "s"} updated`, { id: t })
      } else {
        toast.error(`Scheduled scan: ${ok} updated, ${failed.length} failed (${failed.join(", ")})`, { id: t })
      }
    }

    // Run a check shortly after mount (catch-up for anything already due), then
    // on a steady interval.
    const kickoff = setTimeout(tick, 4_000)
    const interval = setInterval(tick, CHECK_INTERVAL_MS)
    return () => {
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }, [])

  return null
}
