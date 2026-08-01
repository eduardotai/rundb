'use server'

/**
 * Server Action: lazy-ensure Steam official min/recommended requirements
 * for a single game (by slug). Called from the game detail page.
 *
 * - Never accepts a client-supplied Steam AppID (uses DB row only).
 * - Soft-fails on rate limits / misconfiguration so the page stays usable.
 * - Service role write for official_* + negative-cache columns.
 */

import {
  ensureGameOfficialRequirements,
  type EnsureOfficialReqsResult,
} from '@/lib/server/ensure-steam-requirements'

export type { EnsureOfficialReqsResult }

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
