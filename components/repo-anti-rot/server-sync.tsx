"use client"

import { useEffect } from "react"
import { mergeServerRepos, type StoredRepo } from "@/lib/reports-store"

/**
 * Pulls reports ingested from CI (`/api/reports`) into the local store once on
 * mount, so they render in the dashboard alongside any locally-run scans. Renders
 * nothing; the merge fires the store's change event and the UI updates itself.
 */
export function ServerSync() {
  useEffect(() => {
    let cancelled = false
    fetch("/api/reports")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { repos?: StoredRepo[] } | null) => {
        if (cancelled || !data?.repos) return
        mergeServerRepos(data.repos)
      })
      .catch(() => {
        // offline / endpoint unavailable → dashboard just shows local data
      })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
