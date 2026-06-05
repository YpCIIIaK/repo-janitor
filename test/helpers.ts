import { vi } from "vitest"
import type { Issue } from "@/lib/mock-data"
import type { ScanReport, StoredRepo } from "@/lib/reports-store"

/** Build a minimal valid Issue for dashboard tests. */
export function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    category: "hygiene",
    severity: "warning",
    title: "Something",
    location: "src/a.ts:10",
    ageDays: 0,
    detail: "Because reasons.",
    ...over,
  }
}

/** Build a ScanReport from a list of issues (score/grade left to the caller). */
export function report(issues: Issue[], over: Partial<ScanReport> = {}): ScanReport {
  return {
    schemaVersion: 1,
    repo: { owner: "acme", name: "widget", defaultBranch: "main" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    score: 80,
    grade: "B",
    issues,
    ...over,
  }
}

/**
 * In-memory localStorage backing the client stores (snooze, ai-settings, ai-cache).
 * The dashboard tests run in node, where `window` is undefined, so the stores
 * short-circuit to their server fallbacks. Installing a stub `window` (an
 * EventTarget plus this storage) lets us exercise the real read/write paths.
 */
class MemoryStorage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  getItem(key: string): string | null {
    return this.m.has(key) ? (this.m.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.m.set(key, String(value))
  }
  removeItem(key: string): void {
    this.m.delete(key)
  }
  clear(): void {
    this.m.clear()
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
}

/**
 * Stub a browser `window` (EventTarget + localStorage) for one test, returning the
 * storage so the caller can pre-seed or assert. Pair with `vi.unstubAllGlobals()`
 * in an afterEach. Safe to read from too: the stores dispatch CustomEvents on it.
 */
export function installWindow(): MemoryStorage {
  const storage = new MemoryStorage()
  const target = new EventTarget()
  const win = Object.assign(target, {
    localStorage: storage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  })
  vi.stubGlobal("window", win)
  return storage
}

/** Build a StoredRepo wrapping a report. */
export function storedRepo(over: Partial<StoredRepo> = {}): StoredRepo {
  const rep = over.latest ?? report([])
  return {
    id: `${rep.repo.owner}/${rep.repo.name}`,
    url: "https://github.com/acme/widget",
    owner: rep.repo.owner,
    name: rep.repo.name,
    defaultBranch: rep.repo.defaultBranch,
    latest: rep,
    history: [],
    scannedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}
