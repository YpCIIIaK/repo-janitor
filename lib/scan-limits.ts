/**
 * Abuse limits for the public scan endpoint.
 *
 * `/api/scan` clones and scans arbitrary repositories on our machine. Exposed
 * without limits that is someone else's compute bill and a trivial way to fill
 * the disk: every request is minutes of CPU, hundreds of megabytes of IO, and a
 * `git` process. Three separate controls, because they fail differently:
 *
 *  - **rate limit per client** — stops one person from running the box all day
 *  - **concurrency cap** — bounds how much work is in flight at once, which is
 *    what actually protects CPU, memory and disk
 *  - **bounded queue** — absorbs a burst instead of rejecting it, but only up to
 *    a point; past that, failing fast beats holding connections open
 *
 * State is per-process and in memory. On more than one instance each gets its own
 * budget, so the effective limit multiplies by the instance count — fine for a
 * single container, not a substitute for a shared limiter (Redis) if this is ever
 * scaled out horizontally. Say so out loud rather than discovering it in a bill.
 */

export interface ScanLimits {
  /** rolling window for the per-client rate limit */
  windowMs: number
  /** scans allowed per client per window */
  maxPerWindow: number
  /** repositories cloned+scanned concurrently, process-wide */
  maxConcurrent: number
  /** callers allowed to wait for a slot before we start refusing */
  maxQueue: number
  /** how long a caller may wait for a slot before giving up */
  maxQueueWaitMs: number
  /** URLs accepted in a single request */
  maxUrlsPerRequest: number
  /**
   * Proxy hops we control, for reading `x-forwarded-for`. The header is
   * attacker-controlled up to the point our own infrastructure appends to it, so
   * the client address is counted from the RIGHT, not the left: with one proxy in
   * front, a spoofed `x-forwarded-for: 1.2.3.4` becomes `1.2.3.4, <real>` and we
   * still read the real one. Taking `parts[0]` would trust the forgery.
   */
  trustedProxyHops: number
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function limitsFromEnv(): ScanLimits {
  return {
    windowMs: envInt("REPO_ANTI_ROT_SCAN_WINDOW_S", 3600) * 1000,
    maxPerWindow: envInt("REPO_ANTI_ROT_SCAN_PER_WINDOW", 30),
    maxConcurrent: Math.max(1, envInt("REPO_ANTI_ROT_SCAN_CONCURRENCY", 2)),
    maxQueue: envInt("REPO_ANTI_ROT_SCAN_QUEUE", 10),
    maxQueueWaitMs: envInt("REPO_ANTI_ROT_SCAN_QUEUE_WAIT_S", 60) * 1000,
    maxUrlsPerRequest: Math.max(1, envInt("REPO_ANTI_ROT_SCAN_MAX_URLS", 20)),
    trustedProxyHops: Math.max(1, envInt("REPO_ANTI_ROT_TRUSTED_PROXY_HOPS", 1)),
  }
}

/**
 * Best-effort client address. Returns `"unknown"` when no forwarding header is
 * present, which buckets all such callers together — deliberately, since an
 * unidentifiable caller should share one budget rather than get a fresh one.
 */
export function clientIp(request: Request, hops = 1): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      // Count from the right: see `trustedProxyHops`.
      return parts[Math.max(0, parts.length - hops)]
    }
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

// --- rate limiting -------------------------------------------------------

/** Cap the tracked-client table so a spray of forged addresses cannot grow it without bound. */
const MAX_TRACKED_CLIENTS = 10_000

const hits = new Map<string, number[]>()

export interface RateDecision {
  ok: boolean
  /** seconds until the oldest hit falls out of the window (only when !ok) */
  retryAfterSec: number
  /** requests still available in the current window */
  remaining: number
}

export function checkRateLimit(ip: string, limits: ScanLimits, now = Date.now()): RateDecision {
  const cutoff = now - limits.windowMs
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff)

  if (recent.length >= limits.maxPerWindow) {
    hits.set(ip, recent)
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + limits.windowMs - now) / 1000))
    return { ok: false, retryAfterSec, remaining: 0 }
  }

  recent.push(now)
  hits.set(ip, recent)

  if (hits.size > MAX_TRACKED_CLIENTS) {
    // Drop entries whose window has fully expired; if that is not enough, drop
    // the oldest-seen clients. Both are safe: a forgotten client simply gets a
    // fresh budget, which is the lenient direction.
    for (const [key, times] of hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(key)
      if (hits.size <= MAX_TRACKED_CLIENTS) break
    }
    while (hits.size > MAX_TRACKED_CLIENTS) {
      const oldest = hits.keys().next()
      if (oldest.done) break
      hits.delete(oldest.value)
    }
  }

  return { ok: true, retryAfterSec: 0, remaining: limits.maxPerWindow - recent.length }
}

// --- concurrency ---------------------------------------------------------

export class QueueFullError extends Error {
  constructor(readonly queueLength: number) {
    super("scan queue is full")
    this.name = "QueueFullError"
  }
}

export class QueueTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super("timed out waiting for a scan slot")
    this.name = "QueueTimeoutError"
  }
}

let active = 0
const waiting: (() => void)[] = []

/** Number of callers currently waiting for a slot — surfaced to clients as queue position. */
export function queueDepth(): number {
  return waiting.length
}

export function activeScans(): number {
  return active
}

/**
 * Run `fn` while holding one of the `maxConcurrent` scan slots.
 *
 * Throws {@link QueueFullError} when the queue is already at capacity and
 * {@link QueueTimeoutError} when the wait exceeds `maxQueueWaitMs`. An aborted
 * `signal` (client disconnected) also rejects, so a caller who walked away does
 * not keep a slot reserved.
 */
export async function withScanSlot<T>(
  limits: ScanLimits,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (active >= limits.maxConcurrent) {
    if (waiting.length >= limits.maxQueue) throw new QueueFullError(waiting.length)
    await waitForSlot(limits, signal)
  }

  active++
  try {
    return await fn()
  } finally {
    active--
    const next = waiting.shift()
    if (next) next()
  }
}

function waitForSlot(limits: ScanLimits, signal?: AbortSignal): Promise<void> {
  const startedAt = Date.now()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      // Drop our slot from the queue so a stale waiter never wakes a released slot.
      const i = waiting.indexOf(wake)
      if (i !== -1) waiting.splice(i, 1)
      fn()
    }

    const wake = () => done(resolve)
    const onAbort = () => done(() => reject(new Error("client disconnected")))
    const timer = setTimeout(
      () => done(() => reject(new QueueTimeoutError(Date.now() - startedAt))),
      limits.maxQueueWaitMs,
    )

    if (signal?.aborted) return onAbort()
    signal?.addEventListener("abort", onAbort, { once: true })
    waiting.push(wake)
  })
}

/** Test hook: clear all limiter state between cases. */
export function __resetScanLimits(): void {
  hits.clear()
  waiting.length = 0
  active = 0
}
