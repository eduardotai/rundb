'use server'

/**
 * Server Actions for the Public Resolver (Agent 5 high-priority fix).
 *
 * This file exists to solve the major client-boundary problem identified in the
 * Agent 5 review:
 * - All third-party network calls now happen on the server.
 * - Solves CORS, key leakage (RAWG/IGDB), and centralized rate limiting.
 *
 * Client code should use the safe wrappers re-exported from @/lib/data
 * (which delegate here when running in the browser).
 */

import {
  resolveGameExternalIds as resolveGameExternalIdsImpl,
  resolveSteamAppId as resolveSteamAppIdImpl,
  type ExternalIdResolution,
} from '@/lib/game-id-resolver'

import {
  resolveCoverForGame as resolveCoverForGameImpl,
  type ResolvedCover,
} from '@/lib/game-cover-resolver'

export async function resolveGameExternalIdsAction(
  name: string,
  slug?: string
): Promise<ExternalIdResolution> {
  return resolveGameExternalIdsImpl(name, slug)
}

export async function resolveSteamAppIdAction(
  name: string,
  slug?: string
): Promise<string | undefined> {
  return resolveSteamAppIdImpl(name, slug)
}

export async function resolveCoverForGameAction(game: {
  slug: string
  name?: string
}): Promise<ResolvedCover> {
  return resolveCoverForGameImpl(game)
}
