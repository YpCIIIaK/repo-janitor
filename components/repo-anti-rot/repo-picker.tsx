"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { Plus, X, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { GithubRepoCard } from "./github-repo-card"
import { RepoFinder } from "./repo-finder"
import { parseRepoRef, type GithubRepo } from "@/lib/github-repo"
import { useLocale } from "@/components/i18n/locale-provider"

/**
 * Choosing what to scan, explicitly.
 *
 * This replaced a textarea of URLs. The textarea was honest about nothing: a
 * half-typed line looked exactly like a repository, a search query counted as
 * one, and the only way to know what a run would actually do was to count lines
 * yourself. Scanning is minutes of cloning per repository — the one question the
 * form has to answer before you press the button is "which ones, and how many".
 *
 * So the box adds to a list, and the list is the answer. Nothing is scanned that
 * is not shown in it.
 */

/** One chosen repository. `repo` is metadata for the card, when GitHub has it. */
export interface SelectedRepo {
  url: string
  repo?: GithubRepo
}

/**
 * Fallback cap, used until the server says otherwise.
 *
 * The real number comes from /api/scan/limits, because it is configurable per
 * deployment (REPO_ANTI_ROT_SCAN_MAX_URLS) and a form that offers twenty where
 * the server takes one is a promise it cannot keep.
 */
export const MAX_SELECTED = 20

/** Ask the server what it will accept. Falls back to the constant above. */
function useMaxSelected(): number {
  const [max, setMax] = useState(MAX_SELECTED)
  useEffect(() => {
    let alive = true
    void fetch("/api/scan/limits")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { maxUrlsPerRequest?: number } | null) => {
        const n = data?.maxUrlsPerRequest
        if (alive && typeof n === "number" && n > 0) setMax(n)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return max
}

/** Normalise anything acceptable into the clone URL that will be scanned. */
export function toCloneUrl(raw: string): string | null {
  const text = raw.trim()
  const ref = parseRepoRef(text)
  // A GitHub address always becomes its canonical clone URL, so the same
  // repository typed three ways cannot end up in the list three times.
  if (ref) return `https://github.com/${ref.owner}/${ref.name}.git`
  return /^https?:\/\//i.test(text) ? text : null
}

function RepoRow({
  item,
  onRemove,
  disabled,
}: {
  item: SelectedRepo
  onRemove: () => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  return (
    <div className="relative">
      {item.repo ? (
        <GithubRepoCard repo={item.repo} compact />
      ) : (
        // A non-GitHub remote, or one GitHub could not describe. Shown plainly
        // rather than hidden: it is still going to be cloned.
        <div className="rounded-xl border border-border bg-card/60 p-3">
          <p className="truncate pr-8 font-mono text-sm">{item.url}</p>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t("scan.remove")}
        title={t("scan.remove")}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function RepoPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: SelectedRepo[]
  /** Accepts an updater, so the async metadata patch below cannot clobber a
   * list that changed while it was in flight. */
  onChange: Dispatch<SetStateAction<SelectedRepo[]>>
  disabled?: boolean
}) {
  const { t } = useLocale()
  const [text, setText] = useState("")
  const [notice, setNotice] = useState<string | null>(null)

  const maxSelected = useMaxSelected()
  const full = selected.length >= maxSelected
  const chosen = new Set(selected.map((s) => s.url))

  /**
   * Fill in cards for rows that arrived without one — typed by hand, or handed
   * over by a `?url=` link. Driven by the list rather than by the add path, so
   * every way a row can appear ends up looking the same.
   *
   * Best effort: a repository GitHub cannot describe is still perfectly
   * scannable, so a failure leaves the plain row rather than removing it.
   */
  const missing = selected
    .filter((s) => !s.repo && parseRepoRef(s.url))
    .map((s) => s.url)
    .join(" ")

  useEffect(() => {
    if (!missing) return
    const controller = new AbortController()
    for (const url of missing.split(" ")) {
      const ref = parseRepoRef(url)
      if (!ref) continue
      void fetch(
        `/api/github?owner=${encodeURIComponent(ref.owner)}&name=${encodeURIComponent(ref.name)}`,
        { signal: controller.signal },
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { repo?: GithubRepo } | null) => {
          if (!data?.repo) return
          onChange((prev) => prev.map((s) => (s.url === url ? { ...s, repo: data.repo } : s)))
        })
        .catch(() => {})
    }
    return () => controller.abort()
    // `onChange` is a setState function and stable; depending on it would re-run
    // this whenever the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing])

  /**
   * Add a batch, keeping the list unique and capped.
   *
   * A batch rather than a loop of single adds: pasting five URLs would otherwise
   * check each one against the same stale list and let duplicates through.
   */
  function addMany(entries: { url: string; repo?: GithubRepo }[]): number {
    const seen = new Set(selected.map((s) => s.url))
    const fresh: SelectedRepo[] = []
    let duplicate = false

    for (const entry of entries) {
      const url = toCloneUrl(entry.url)
      if (!url) continue
      if (seen.has(url)) {
        duplicate = true
        continue
      }
      if (selected.length + fresh.length >= maxSelected) {
        setNotice(t("scan.limit", { max: maxSelected }))
        break
      }
      seen.add(url)
      fresh.push({ url, ...(entry.repo ? { repo: entry.repo } : {}) })
    }

    if (fresh.length === 0) {
      if (duplicate) setNotice(t("scan.duplicate"))
      return 0
    }
    if (!duplicate) setNotice(null)
    onChange((prev) => [...prev, ...fresh])
    return fresh.length
  }

  function addFromText() {
    // Pasting a list should still work — it is how anyone with a batch arrives.
    const parts = text.split(/[\s,]+/).filter(Boolean)
    if (addMany(parts.map((url) => ({ url }))) > 0) setText("")
  }

  const canAdd = toCloneUrl(text) !== null && !full

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNotice(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) {
              e.preventDefault()
              addFromText()
            }
          }}
          placeholder={t("scan.inputPlaceholder")}
          className="font-mono text-sm"
          disabled={disabled || full}
        />
        <Button variant="outline" onClick={addFromText} disabled={disabled || !canAdd}>
          <Plus className="size-4" />
          {t("scan.add")}
        </Button>
      </div>

      {notice && <p className="text-xs text-chart-3">{notice}</p>}
      {full && <p className="text-xs text-muted-foreground">{t("scan.limit", { max: maxSelected })}</p>}

      {/* Search results and previews. Clicking one adds it rather than filling
          the box, so there is one action, not two — and the results stay on
          screen afterwards, because picking several from one search is the
          normal case. */}
      {!disabled && (
        <RepoFinder
          text={text}
          canAdd={!full}
          isAdded={(url) => chosen.has(toCloneUrl(url) ?? url)}
          onPick={(cloneUrl, repo) => addMany([{ url: cloneUrl, repo }])}
        />
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("scan.selectedTitle", { count: selected.length, max: maxSelected })}
          </p>
          {selected.length > 1 && (
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={disabled}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
              {t("scan.clearAll")}
            </button>
          )}
        </div>

        {selected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {t("scan.selectedEmpty")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {selected.map((item) => (
              <RepoRow
                key={item.url}
                item={item}
                disabled={disabled}
                onRemove={() => onChange((prev) => prev.filter((s) => s.url !== item.url))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Exposed for the `?url=` prefill, which adds before the picker is interactive. */
export function useInitialUrl(add: (url: string) => void) {
  useEffect(() => {
    let raw = ""
    try {
      raw = new URLSearchParams(window.location.search).get("url") ?? ""
    } catch {
      return
    }
    // Through the same normalisation as everything else. Adding the raw string
    // put a non-canonical URL in the list, and "already in the list" then missed
    // the very repository the link arrived for.
    const url = toCloneUrl(raw)
    if (url) add(url)
    // Once, after mount: the server has no query string, so doing this during
    // render makes the first client render disagree with the server HTML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
