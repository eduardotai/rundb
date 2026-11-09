/**
 * lib/server/steam-link.ts: one Steam account per RunDB user.
 * In-memory store mirrors the DB rules (UNIQUE (provider, provider_user_id) and UNIQUE (user_id, provider)).
 *
 * Run: npx tsx --test tests/steam-link.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AUTH_ERROR_COPY } from '../lib/auth-error-copy'
import {
  linkSteamAccount,
  serviceSteamLinkStore,
  type SteamLinkFailure,
  type SteamLinkStore,
} from '../lib/server/steam-link'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STEAM = '76561190000000001'
const NOW = new Date('2026-11-09T12:00:00Z')

function memoryStore(opts: { links?: Record<string, string>; raceOwner?: string; failLookup?: boolean; failLink?: boolean; failMirror?: boolean } = {}) {
  // user_id -> steam id
  const links = new Map<string, string>(Object.entries(opts.links ?? {}))
  const mirror = new Map<string, string>()
  const writes: string[] = []
  const store: SteamLinkStore = {
    async findSteamOwner(steamId) {
      if (opts.failLookup) return { userId: null, error: { code: '08006', message: 'connection lost' } }
      const owner = [...links.entries()].find(([, s]) => s === steamId)?.[0] ?? null
      return { userId: owner, error: null }
    },
    async upsertLink(row) {
      writes.push(`link:${row.user_id}:${row.provider_user_id}`)
      if (opts.failLink) return { code: '42P01', message: 'relation missing' }
      if (opts.raceOwner && opts.raceOwner !== row.user_id) return { code: '23505', message: 'duplicate key value' }
      const taken = [...links.entries()].some(([u, s]) => s === row.provider_user_id && u !== row.user_id)
      if (taken) return { code: '23505', message: 'duplicate key value' }
      links.set(row.user_id, row.provider_user_id) // ON CONFLICT (user_id, provider) DO UPDATE
      return null
    },
    async upsertProfileMirror(row) {
      writes.push(`mirror:${row.id}:${row.steam_id}`)
      if (opts.failMirror) return { code: '23505', message: 'profiles_steam_id_key' }
      mirror.set(row.id, row.steam_id)
      return null
    },
  }
  return { store, links, mirror, writes }
}

const input = (userId: string, steamId = STEAM) => ({ userId, steamId, profile: { steamid: steamId, personaname: 'p' }, now: NOW })

test('first link writes the link and the profile mirror', async () => {
  const m = memoryStore()
  assert.deepEqual(await linkSteamAccount(m.store, input(A)), { ok: true })
  assert.equal(m.links.get(A), STEAM)
  assert.equal(m.mirror.get(A), STEAM)
})

test('same user re-linking the same Steam id is idempotent', async () => {
  const m = memoryStore({ links: { [A]: STEAM } })
  assert.deepEqual(await linkSteamAccount(m.store, input(A)), { ok: true })
  assert.deepEqual(await linkSteamAccount(m.store, input(A)), { ok: true })
  assert.deepEqual([...m.links.entries()], [[A, STEAM]])
})

test('a Steam id linked to another user is refused and nothing is written', async () => {
  const m = memoryStore({ links: { [A]: STEAM } })
  assert.deepEqual(await linkSteamAccount(m.store, input(B)), { ok: false, reason: 'steam_already_linked' })
  assert.deepEqual(m.writes, [], 'no link or mirror write for the second user')
  assert.deepEqual([...m.links.entries()], [[A, STEAM]], 'existing link untouched')
})

test('a concurrent link by another user (23505 on upsert) maps to steam_already_linked, mirror untouched', async () => {
  const m = memoryStore({ raceOwner: A })
  assert.deepEqual(await linkSteamAccount(m.store, input(B)), { ok: false, reason: 'steam_already_linked' })
  assert.deepEqual(m.writes, [`link:${B}:${STEAM}`])
})

test('other DB failures map to db_error (lookup or link)', async () => {
  assert.deepEqual(await linkSteamAccount(memoryStore({ failLookup: true }).store, input(A)), { ok: false, reason: 'db_error' })
  const m = memoryStore({ failLink: true })
  assert.deepEqual(await linkSteamAccount(m.store, input(A)), { ok: false, reason: 'db_error' })
  assert.equal(m.writes.some((w) => w.startsWith('mirror')), false)
})

test('profile mirror failure is non-fatal once the link is saved', async () => {
  const m = memoryStore({ failMirror: true })
  assert.deepEqual(await linkSteamAccount(m.store, input(A)), { ok: true })
  assert.equal(m.links.get(A), STEAM)
})

test('a user can switch to a different, unclaimed Steam account', async () => {
  const m = memoryStore({ links: { [A]: STEAM } })
  assert.deepEqual(await linkSteamAccount(m.store, input(A, '76561190000000002')), { ok: true })
  assert.equal(m.links.get(A), '76561190000000002')
})

test('every failure reason has user-facing copy on /auth/auth-code-error', () => {
  const reasons: SteamLinkFailure[] = ['steam_already_linked', 'db_error']
  for (const r of reasons) assert.ok(AUTH_ERROR_COPY[r]?.title && AUTH_ERROR_COPY[r]?.body, r)
  assert.match(AUTH_ERROR_COPY.steam_already_linked.body, /already linked to another RunDB user/)
})

test('service store: owner lookup filters by provider + Steam id; upsert targets (user_id, provider)', async () => {
  const calls: { op: string; args: unknown[] }[] = []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq']) chain[op] = (...args: unknown[]) => (calls.push({ op, args }), chain)
  chain.maybeSingle = async () => ({ data: { user_id: A }, error: null })
  chain.upsert = async (...args: unknown[]) => (calls.push({ op: 'upsert', args }), { error: { code: '23505', message: 'dup' } })
  const client = { from: (t: string) => (calls.push({ op: 'from', args: [t] }), chain) } as unknown as SupabaseClient
  const store = serviceSteamLinkStore(client)

  assert.deepEqual(await store.findSteamOwner(STEAM), { userId: A, error: null })
  assert.deepEqual(calls.filter((c) => c.op === 'eq').map((c) => c.args), [['provider', 'steam'], ['provider_user_id', STEAM]])

  const err = await store.upsertLink({ user_id: B, provider: 'steam', provider_user_id: STEAM, provider_data: { steamid: STEAM } })
  assert.equal(err?.code, '23505')
  const up = calls.find((c) => c.op === 'upsert')!
  assert.deepEqual(up.args[1], { onConflict: 'user_id,provider' })
})

test('callback route writes links only through linkSteamAccount and redirects with its reason', () => {
  const src = readFileSync('app/auth/steam/callback/route.ts', 'utf8')
  assert.match(src, /linkSteamAccount\(serviceSteamLinkStore\(createServiceClient\(\)\)/)
  assert.match(src, /auth-code-error\?reason=\$\{linked\.reason\}/)
  assert.doesNotMatch(src, /from\('linked_accounts'\)/, 'no direct linked_accounts writes in the route')
  assert.doesNotMatch(src, /from\('profiles'\)/, 'no direct profiles writes in the route')
})
