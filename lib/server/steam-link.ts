/**
 * Server-side write of a verified Steam link (called by app/auth/steam/callback/route.ts after
 * OpenID verification and the session check).
 *
 * Rule: one Steam account belongs to at most one RunDB user. The DB enforces it with
 * UNIQUE (provider, provider_user_id) on linked_accounts and a unique profiles.steam_id
 * (migration 20261109000900); this module never overwrites another user's link and maps the
 * conflict to a friendly reason. Re-linking the same Steam id by the same user is idempotent.
 *
 * Tested with an in-memory store in tests/steam-link.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type SteamLinkFailure = 'steam_already_linked' | 'db_error'
export type SteamLinkResult = { ok: true } | { ok: false; reason: SteamLinkFailure }

export interface SteamProfileSnapshot {
  steamid: string
  personaname?: string
  avatar_url?: string
  profile_url?: string
}

type DbError = { code?: string; message?: string } | null

/** The three writes/reads the link needs; backed by the service-role client in production. */
export interface SteamLinkStore {
  /** user_id currently holding this Steam id, or null. */
  findSteamOwner(steamId: string): Promise<{ userId: string | null; error: DbError }>
  /** Upsert the caller's single Steam link (conflict target: user_id, provider). */
  upsertLink(row: { user_id: string; provider: 'steam'; provider_user_id: string; provider_data: SteamProfileSnapshot }): Promise<DbError>
  /** Mirror persona/avatar onto profiles (best effort). */
  upsertProfileMirror(row: {
    id: string
    steam_id: string
    steam_persona: string | null
    steam_avatar_url: string | null
    steam_linked_at: string
  }): Promise<DbError>
}

const UNIQUE_VIOLATION = '23505'

export async function linkSteamAccount(
  store: SteamLinkStore,
  input: { userId: string; steamId: string; profile: SteamProfileSnapshot; now?: Date },
): Promise<SteamLinkResult> {
  const { userId, steamId, profile } = input

  // Fast, friendly path: someone else already owns this Steam id. Never write in that case.
  const owner = await store.findSteamOwner(steamId)
  if (owner.error) {
    console.error('[steam-link] owner lookup failed', owner.error)
    return { ok: false, reason: 'db_error' }
  }
  if (owner.userId && owner.userId !== userId) return { ok: false, reason: 'steam_already_linked' }

  const linkErr = await store.upsertLink({
    user_id: userId,
    provider: 'steam',
    provider_user_id: steamId,
    provider_data: profile,
  })
  if (linkErr) {
    // A concurrent link by another user wins the race: the unique constraint rejects ours.
    if (linkErr.code === UNIQUE_VIOLATION) return { ok: false, reason: 'steam_already_linked' }
    console.error('[steam-link] link upsert failed', linkErr)
    return { ok: false, reason: 'db_error' }
  }

  const profErr = await store.upsertProfileMirror({
    id: userId,
    steam_id: steamId,
    steam_persona: profile.personaname || null,
    steam_avatar_url: profile.avatar_url || null,
    steam_linked_at: (input.now ?? new Date()).toISOString(),
  })
  if (profErr) console.warn('[steam-link] profile mirror failed (non-fatal)', profErr.code, profErr.message)

  return { ok: true }
}

/** Production store: service-role client (clients cannot write links or the steam_* mirror). */
export function serviceSteamLinkStore(service: SupabaseClient): SteamLinkStore {
  return {
    async findSteamOwner(steamId) {
      const { data, error } = await service
        .from('linked_accounts')
        .select('user_id')
        .eq('provider', 'steam')
        .eq('provider_user_id', steamId)
        .maybeSingle()
      return { userId: (data as { user_id?: string } | null)?.user_id ?? null, error }
    },
    async upsertLink(row) {
      const { error } = await service.from('linked_accounts').upsert(row, { onConflict: 'user_id,provider' })
      return error
    },
    async upsertProfileMirror(row) {
      const { error } = await service.from('profiles').upsert(row)
      return error
    },
  }
}
