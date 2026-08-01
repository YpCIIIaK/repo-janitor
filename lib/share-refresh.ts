import { loadShareHandle, saveShareHandle, repoFromReport } from "@/lib/share-handle"
import { usageHeaders } from "@/lib/visitor"

/**
 * Push a fresh snapshot to an existing live share from this browser.
 *
 * No-op when there is no manage handle in localStorage — publishing stays an
 * explicit consent action; this only keeps URLs already published up to date
 * after a rescan.
 */
export async function refreshPublishedShare(
  report: unknown,
  repoUrl?: string,
): Promise<"updated" | "skipped" | "failed"> {
  const repo = repoFromReport(report)
  if (!repo) return "skipped"
  const handle = loadShareHandle(repo.owner, repo.name)
  if (!handle) return "skipped"

  try {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json", ...usageHeaders() },
      body: JSON.stringify({ report, repoUrl, manageKey: handle.manageKey }),
    })
    if (!res.ok) return "failed"
    const data = (await res.json()) as {
      token?: string
      manageKey?: string
      path?: string
      updatedAt?: string
    }
    if (!data.token || !data.manageKey || !data.path) return "failed"
    const absolute =
      typeof window !== "undefined"
        ? new URL(data.path, window.location.origin).toString()
        : data.path
    saveShareHandle({
      token: data.token,
      manageKey: data.manageKey,
      path: absolute,
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      owner: repo.owner,
      name: repo.name,
    })
    return "updated"
  } catch {
    return "failed"
  }
}
