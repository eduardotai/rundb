/**
 * Minimal in-memory fixed-window rate limiter for server actions / route handlers.
 *
 * Best-effort by design: state lives in the process, so on serverless deploys each
 * warm instance keeps its own counters. That is enough to blunt hot loops against
 * unauthenticated actions that use the service role or call third-party APIs, without
 * adding infrastructure. Use a shared store (DB RPC, Redis) for hard guarantees —
 * see the `submit_report` RPC pattern for the DB-backed approach.
 */

interface WindowEntry {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  /** Max hits allowed per key within `windowMs`. */
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  /** Milliseconds until the window resets (0 when allowed and window is fresh). */
  retryAfterMs: number
}

const MAX_TRACKED_KEYS = 10_000

export function createRateLimiter(options: RateLimitOptions) {
  const store = new Map<string, WindowEntry>()

  function sweep(now: number) {
    if (store.size < MAX_TRACKED_KEYS) return
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key)
    }
    // Still oversized (burst of distinct keys): drop oldest insertions.
    while (store.size >= MAX_TRACKED_KEYS) {
      const oldest = store.keys().next().value
      if (oldest === undefined) break
      store.delete(oldest)
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      const entry = store.get(key)
      if (!entry || entry.resetAt <= now) {
        sweep(now)
        store.set(key, { count: 1, resetAt: now + options.windowMs })
        return { ok: true, remaining: options.limit - 1, retryAfterMs: 0 }
      }
      if (entry.count >= options.limit) {
        return { ok: false, remaining: 0, retryAfterMs: Math.max(0, entry.resetAt - now) }
      }
      entry.count += 1
      return { ok: true, remaining: options.limit - entry.count, retryAfterMs: 0 }
    },
    /** Test helper. */
    reset() {
      store.clear()
    },
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
