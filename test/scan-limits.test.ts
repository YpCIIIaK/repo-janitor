import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  QueueFullError,
  QueueTimeoutError,
  __resetScanLimits,
  activeScans,
  checkRateLimit,
  clientIp,
  limitsFromEnv,
  queueDepth,
  withScanSlot,
} from "@/lib/scan-limits"
import type { ScanLimits } from "@/lib/scan-limits"

const base: ScanLimits = {
  windowMs: 60_000,
  maxPerWindow: 3,
  maxConcurrent: 2,
  maxQueue: 2,
  maxQueueWaitMs: 1_000,
  maxUrlsPerRequest: 20,
  trustedProxyHops: 1,
}

const req = (headers: Record<string, string> = {}) =>
  new Request("https://scan.example/api/scan", { headers })

beforeEach(() => __resetScanLimits())

describe("clientIp", () => {
  it("reads the client from the right of x-forwarded-for, not the left", () => {
    // An attacker prepends a forged address; our proxy appends the real one.
    // Reading parts[0] would trust the forgery and hand out a fresh budget.
    const r = req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })
    expect(clientIp(r, 1)).toBe("203.0.113.7")
  })

  it("accounts for multiple trusted hops", () => {
    const r = req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })
    expect(clientIp(r, 2)).toBe("203.0.113.7")
  })

  it("handles a single-entry header", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }), 1)).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }), 1)).toBe("198.51.100.4")
    // Unidentifiable callers deliberately share one budget rather than each
    // getting a fresh one.
    expect(clientIp(req(), 1)).toBe("unknown")
  })
})

describe("checkRateLimit", () => {
  it("allows up to the cap, then refuses with a retry hint", () => {
    const now = 1_000_000
    for (let i = 0; i < base.maxPerWindow; i++) {
      expect(checkRateLimit("a", base, now).ok).toBe(true)
    }
    const denied = checkRateLimit("a", base, now)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSec).toBe(60)
  })

  it("reports how much budget is left", () => {
    const now = 1_000_000
    expect(checkRateLimit("a", base, now).remaining).toBe(2)
    expect(checkRateLimit("a", base, now).remaining).toBe(1)
    expect(checkRateLimit("a", base, now).remaining).toBe(0)
  })

  it("keeps clients in separate budgets", () => {
    const now = 1_000_000
    for (let i = 0; i < base.maxPerWindow; i++) checkRateLimit("a", base, now)
    expect(checkRateLimit("a", base, now).ok).toBe(false)
    expect(checkRateLimit("b", base, now).ok).toBe(true)
  })

  it("lets the window roll forward", () => {
    const now = 1_000_000
    for (let i = 0; i < base.maxPerWindow; i++) checkRateLimit("a", base, now)
    expect(checkRateLimit("a", base, now + base.windowMs - 1).ok).toBe(false)
    expect(checkRateLimit("a", base, now + base.windowMs + 1).ok).toBe(true)
  })
})

describe("withScanSlot", () => {
  const deferred = () => {
    let release!: () => void
    const promise = new Promise<void>((r) => (release = r))
    return { promise, release }
  }

  it("does not start an already disconnected request even with a free slot", async () => {
    const controller = new AbortController()
    controller.abort()
    const work = vi.fn(async () => "unexpected")
    await expect(withScanSlot(base, work, controller.signal)).rejects.toThrow(/disconnected/)
    expect(work).not.toHaveBeenCalled()
    expect(activeScans()).toBe(0)
    expect(queueDepth()).toBe(0)
  })

  it("reserves a released slot for its waiter before a new arrival can run", async () => {
    const limits = { ...base, maxConcurrent: 1, maxQueue: 3 }
    const first = deferred()
    const waiter = deferred()
    const order: string[] = []
    let peak = 0
    const record = (name: string) => { order.push(name); peak = Math.max(peak, activeScans()) }
    const running = withScanSlot(limits, () => first.promise)
    const queued = withScanSlot(limits, () => { record("waiter"); return waiter.promise })
    let arrival!: Promise<void>
    first.release()
    // Runs after the releasing job's finally but before the waiter's resumed
    // continuation. This is the interval in which an unreserved slot is stolen.
    queueMicrotask(() => {
      arrival = withScanSlot(limits, async () => { record("arrival") })
    })
    await running
    await Promise.resolve()
    expect(order).toEqual(["waiter"])
    expect(queueDepth()).toBe(1)
    expect(activeScans()).toBe(1)
    waiter.release()
    await Promise.all([queued, arrival])
    expect(order).toEqual(["waiter", "arrival"])
    expect(peak).toBe(1)
    expect(activeScans()).toBe(0)
  })

  it("shares concurrency and rate state between separately loaded module copies", async () => {
    vi.resetModules()
    const anotherRoute = await import("@/lib/scan-limits")
    const held = deferred()
    const running = withScanSlot({ ...base, maxConcurrent: 1 }, () => held.promise)
    expect(anotherRoute.activeScans()).toBe(1)
    const queued = anotherRoute.withScanSlot({ ...base, maxConcurrent: 1 }, async () => "done")
    expect(queueDepth()).toBe(1)
    checkRateLimit("shared", base, 1_000_000)
    expect(anotherRoute.checkRateLimit("shared", base, 1_000_000).remaining).toBe(1)
    held.release()
    await Promise.all([running, queued])
    expect(anotherRoute.activeScans()).toBe(0)
  })

  it("runs up to maxConcurrent at once and queues the rest", async () => {
    const a = deferred()
    const b = deferred()
    const c = deferred()

    const p1 = withScanSlot(base, () => a.promise)
    const p2 = withScanSlot(base, () => b.promise)
    await Promise.resolve()
    expect(activeScans()).toBe(2)

    let thirdStarted = false
    const p3 = withScanSlot(base, () => {
      thirdStarted = true
      return c.promise
    })
    await Promise.resolve()
    expect(thirdStarted).toBe(false) // waiting, not running
    expect(queueDepth()).toBe(1)

    a.release()
    await p1
    await Promise.resolve()
    expect(thirdStarted).toBe(true) // the freed slot woke the waiter

    b.release()
    c.release()
    await Promise.all([p2, p3])
    expect(activeScans()).toBe(0)
  })

  it("refuses once the queue is full instead of holding connections open", async () => {
    const held = deferred()
    const running = [
      withScanSlot(base, () => held.promise),
      withScanSlot(base, () => held.promise),
    ]
    await Promise.resolve()

    const queued = [
      withScanSlot(base, () => held.promise),
      withScanSlot(base, () => held.promise),
    ]
    await Promise.resolve()
    expect(queueDepth()).toBe(base.maxQueue)

    await expect(withScanSlot(base, async () => "nope")).rejects.toBeInstanceOf(QueueFullError)

    held.release()
    await Promise.all([...running, ...queued])
  })

  it("gives up rather than waiting forever", async () => {
    vi.useFakeTimers()
    try {
      const held = deferred()
      const running = [
        withScanSlot(base, () => held.promise),
        withScanSlot(base, () => held.promise),
      ]
      await Promise.resolve()

      const late = withScanSlot(base, async () => "never")
      const assertion = expect(late).rejects.toBeInstanceOf(QueueTimeoutError)
      await vi.advanceTimersByTimeAsync(base.maxQueueWaitMs + 10)
      await assertion

      held.release()
      await Promise.all(running)
    } finally {
      vi.useRealTimers()
    }
  })

  it("releases the queue slot when the client disconnects", async () => {
    const held = deferred()
    const running = [
      withScanSlot(base, () => held.promise),
      withScanSlot(base, () => held.promise),
    ]
    await Promise.resolve()

    const ac = new AbortController()
    const abandoned = withScanSlot(base, async () => "never", ac.signal)
    await Promise.resolve()
    expect(queueDepth()).toBe(1)

    ac.abort()
    await expect(abandoned).rejects.toThrow(/disconnected/)
    // The walked-away caller must not keep occupying a queue position.
    expect(queueDepth()).toBe(0)

    held.release()
    await Promise.all(running)
  })

  it("frees the slot even when the work throws", async () => {
    await expect(
      withScanSlot(base, async () => {
        throw new Error("scan blew up")
      }),
    ).rejects.toThrow("scan blew up")
    expect(activeScans()).toBe(0)
  })
})

describe("limitsFromEnv", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("has usable defaults with nothing configured", () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("REPO_ANTI_ROT_SCAN") || k === "REPO_ANTI_ROT_TRUSTED_PROXY_HOPS") {
        delete process.env[k]
      }
    }
    const l = limitsFromEnv()
    expect(l.maxPerWindow).toBe(30)
    expect(l.maxConcurrent).toBe(2)
    expect(l.windowMs).toBe(3_600_000)
  })

  it("reads overrides and never drops concurrency below one", () => {
    process.env.REPO_ANTI_ROT_SCAN_PER_WINDOW = "5"
    process.env.REPO_ANTI_ROT_SCAN_CONCURRENCY = "0"
    const l = limitsFromEnv()
    expect(l.maxPerWindow).toBe(5)
    expect(l.maxConcurrent).toBe(1) // 0 would deadlock every request
  })

  it("ignores junk rather than collapsing to zero", () => {
    process.env.REPO_ANTI_ROT_SCAN_PER_WINDOW = "not-a-number"
    expect(limitsFromEnv().maxPerWindow).toBe(30)
  })
})
