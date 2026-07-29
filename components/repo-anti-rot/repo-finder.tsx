"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { GithubRepoCard } from "./github-repo-card"
import { parseRepoRef, looksLikeQuery, type GithubRepo } from "@/lib/github-repo"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * Looks up whatever is in the box: a preview card for a repository address, a
 * short result list for anything else.
 *
 * The point is to close the gap between typing an address and finding out what
 * it was. A scan costs a clone and a couple of minutes; a card costs one cached
 * request and tells you now that you typed the wrong owner, or that the project
 * was archived in 2019.
 *
 * Everything here is a preview. It never starts a scan by itself and never
 * changes the box — the URL you typed is the URL that gets scanned.
 */

const DEBOUNCE_MS = 400
/** Below this, a query matches half of GitHub and the request is wasted. */
const MIN_QUERY = 3

type Outcome =
  | { kind: "loading" }
  | { kind: "repo"; repo: GithubRepo }
  | { kind: "results"; repos: GithubRepo[] }
  | { kind: "message"; key: "repo.notFound" | "repo.noResults" | "repo.searchError" }

/**
 * What the text asks for, as a stable key: "" when it asks for nothing.
 *
 * The answer is stored against the key that produced it, so a result from two
 * keystrokes ago is simply not rendered rather than having to be cleared. That
 * also keeps the effect free of a synchronous "reset to idle" setState, which
 * would cascade a render on every keystroke.
 */
function lookupKey(text: string): string {
  const trimmed = text.trim()
  const ref = parseRepoRef(trimmed)
  if (ref) return `repo:${ref.owner}/${ref.name}`
  if (looksLikeQuery(trimmed) && trimmed.length >= MIN_QUERY) return `q:${trimmed}`
  return ""
}

export function RepoFinder({
  text,
  onPick,
}: {
  /** The line currently being edited. */
  text: string
  /** Called with a clone URL when a search result is chosen. */
  onPick: (cloneUrl: string) => void
}) {
  const { t } = useLocale()
  const key = lookupKey(text)
  const [answer, setAnswer] = useState<{ key: string; outcome: Outcome } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!key) return

    // Cancel whatever the previous keystroke started: without this a slow early
    // request can land after a fast later one and overwrite the right answer.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const set = (outcome: Outcome) => setAnswer({ key, outcome })

    const timer = setTimeout(async () => {
      set({ kind: "loading" })
      const params = key.startsWith("repo:")
        ? (() => {
            const [owner, name] = key.slice(5).split("/")
            return `owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(name)}`
          })()
        : `q=${encodeURIComponent(key.slice(2))}`
      try {
        const res = await fetch(`/api/github?${params}`, { signal: controller.signal })
        const data = (await res.json().catch(() => null)) as {
          repo?: GithubRepo
          repos?: GithubRepo[]
        } | null

        if (res.status === 404) {
          set({ kind: "message", key: "repo.notFound" })
        } else if (!res.ok) {
          set({ kind: "message", key: "repo.searchError" })
        } else if (data?.repo) {
          set({ kind: "repo", repo: data.repo })
        } else if (data?.repos?.length) {
          set({ kind: "results", repos: data.repos })
        } else {
          set({ kind: "message", key: "repo.noResults" })
        }
      } catch (err) {
        // An abort is this component doing its job, not a failure to report.
        if ((err as Error)?.name === "AbortError") return
        set({ kind: "message", key: "repo.searchError" })
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Nothing to look up, or the answer on hand belongs to older text.
  if (!key || answer?.key !== key) return null
  const state = answer.outcome

  if (state.kind === "loading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t("repo.searching")}
      </p>
    )
  }

  if (state.kind === "message") {
    return <p className="text-xs text-muted-foreground">{t(state.key)}</p>
  }

  if (state.kind === "repo") {
    return <GithubRepoCard repo={state.repo} />
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="size-3.5" />
        {t("repo.results")}
      </p>
      <div className="space-y-1.5">
        {state.repos.map((repo) => (
          <button
            key={repo.fullName}
            type="button"
            onClick={() => onPick(repo.cloneUrl)}
            className="block w-full text-left"
          >
            <GithubRepoCard repo={repo} compact />
          </button>
        ))}
      </div>
    </div>
  )
}
