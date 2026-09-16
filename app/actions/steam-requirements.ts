'use server'

/**
 * Server Action: lazy-ensure Steam official min/recommended requirements
 * for a single game (by slug). Called from the game detail page.
 *
 * - Never accepts a client-supplied Steam AppID (uses DB row only).
 * - Soft-fails on rate limits / misconfiguration so the page stays usable.
 * - Service role write for official_* + negative-cache columns.
 * - Unauthenticated by design (anonymous visitors trigger it), so it is throttled
 *   per client IP and per slug before any service-role / Steam work happens.
 */

import { headers } from 'next/headers'
import {
  ensureGameOfficialRequirements,
  type EnsureOfficialReqsResult,
} from '@/lib/server/ensure-steam-requirements'
import { clientIpFromHeaders, createRateLimiter } from '@/lib/server/rate-limit'

export type { EnsureOfficialReqsResult }

// Per-IP: generous enough for a user browsing many game pages; blocks tight loops.
const ipLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 })
// Per-slug: the ensure has an in-flight dedupe + DB negative cache, so a handful of
// calls per minute is plenty for legitimate traffic on one title.
const slugLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

function rateLimitedResult(retryAfterMs: number): EnsureOfficialReqsResult {
  return {
    ok: false,
    status: 'rate_limited',
    reason: 'client_rate_limited',
    message: `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
  }
}

function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > 200) return false
  // Allow typical game slugs: alphanumerics, hyphen, underscore, period
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)
}

export async function ensureGameOfficialRequirementsAction(
  slug: string
): Promise<EnsureOfficialReqsResult> {
  const normalized = typeof slug === 'string' ? slug.trim() : ''
  if (!isValidSlug(normalized)) {
    return { ok: false, status: 'error', message: 'Invalid game slug' }
  }

  const ip = clientIpFromHeaders(await headers())
  const ipCheck = ipLimiter.check(`ip:${ip}`)
  if (!ipCheck.ok) {
    console.warn(`[ensure-steam-reqs] ip rate limit hit ip=${ip} slug=${normalized}`)
    return rateLimitedResult(ipCheck.retryAfterMs)
  }
  const slugCheck = slugLimiter.check(`slug:${normalized.toLowerCase()}`)
  if (!slugCheck.ok) {
    console.warn(`[ensure-steam-reqs] slug rate limit hit slug=${normalized}`)
    return rateLimitedResult(slugCheck.retryAfterMs)
  }

  // Match lib/data.ts USE_REAL: default on unless explicitly 'false' (or mock-only mode).
  const allowMock = process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA === 'true'
  const useReal =
    process.env.NEXT_PUBLIC_USE_REAL_DATA !== 'false' || !allowMock
  if (!useReal) {
    return {
      ok: true,
      status: 'skipped',
      reason: 'mock_or_real_data_off',
    }
  }

  let client
  try {
    const { createServiceClient } = await import('@/lib/supabase/service')
    client = createServiceClient()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[ensure-steam-reqs] service client unavailable:', msg)
    return {
      ok: false,
      status: 'misconfigured',
      message: 'Server is not configured to load official requirements',
    }
  }

  try {
    const result = await ensureGameOfficialRequirements(client, normalized)
    console.log(
      `[ensure-steam-reqs] slug=${normalized} status=${result.status}` +
        (result.reason ? ` reason=${result.reason}` : '') +
        (result.fetched ? ' fetched=1' : ' fetched=0')
    )
    // Surface no-Steam-id clearly for the game-detail UI (not a hard failure).
    if (result.status === 'skipped' && result.reason === 'no_steam_id') {
      return {
        ...result,
        message:
          'This game is not linked to a Steam App ID, so publisher min/recommended specs cannot be loaded automatically.',
      }
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ensure-steam-reqs] unexpected error:', msg)
    return {
      ok: false,
      status: 'error',
      message: 'Could not load official requirements',
    }
  }
}
