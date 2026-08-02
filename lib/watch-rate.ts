/**
 * Tiny in-memory rate limit for watch subscribe / magic-link.
 * Same process-local caveats as scan-limits — fine for a single container.
 */

type Bucket = { resetAt: number; count: number }

const buckets = new Map<string, Bucket>()

export function allowRate(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 })
    return true
  }
  if (b.count >= max) return false
  b.count += 1
  return true
}

/** Test helper. */
export function resetWatchRate(): void {
  buckets.clear()
}
