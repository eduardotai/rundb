import assert from 'node:assert/strict'
import test from 'node:test'
import type { HardwareSpec } from '../types'
import {
  hasAnyOfficialReqs,
  isEmptyOfficialReqs,
  mergeOfficialReqsColumns,
  OFFICIAL_REQS_EMPTY_TTL_MS,
  OFFICIAL_REQS_ERROR_COOLDOWN_MS,
  OFFICIAL_REQS_PENDING_TTL_MS,
  OFFICIAL_REQS_RATE_LIMIT_COOLDOWN_MS,
  shouldEnsureOfficialReqs,
  statusAfterSuccessfulFetch,
  ensureGameOfficialRequirements,
  type OfficialReqsGameRow,
} from './ensure-steam-requirements'
import type { FetchSteamOfficialReqsResult } from './steam-requirements'

const sample: HardwareSpec = { cpu: 'i5-8400', gpu: 'GTX 1060', ram: 8 }
const sampleRec: HardwareSpec = { cpu: 'i7-8700', gpu: 'RTX 2060', ram: 16 }

function baseRow(over: Partial<OfficialReqsGameRow> = {}): OfficialReqsGameRow {
  return {
    id: 'g1',
    slug: 'test-game',
    name: 'Test Game',
    steam_app_id: 12345,
    official_min_reqs: null,
    official_rec_reqs: null,
    official_reqs_checked_at: null,
    official_reqs_status: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// isEmpty / merge
// ---------------------------------------------------------------------------

test('isEmptyOfficialReqs: null and empty object', () => {
  assert.equal(isEmptyOfficialReqs(null), true)
  assert.equal(isEmptyOfficialReqs(undefined), true)
  assert.equal(isEmptyOfficialReqs({}), true)
  assert.equal(isEmptyOfficialReqs({ cpu: '', gpu: '', ram: 0 }), true)
  assert.equal(isEmptyOfficialReqs(sample), false)
})

test('hasAnyOfficialReqs', () => {
  assert.equal(hasAnyOfficialReqs(null, null), false)
  assert.equal(hasAnyOfficialReqs(sample, null), true)
  assert.equal(hasAnyOfficialReqs(null, sampleRec), true)
})

test('mergeOfficialReqsColumns never wipes existing min', () => {
  const merged = mergeOfficialReqsColumns(sample, null, {
    official_min_reqs: { cpu: 'other', gpu: 'x', ram: 4 },
    official_rec_reqs: sampleRec,
  })
  assert.equal(merged.official_min_reqs, undefined)
  assert.deepEqual(merged.official_rec_reqs, sampleRec)
})

test('mergeOfficialReqsColumns fills empty min', () => {
  const merged = mergeOfficialReqsColumns(null, null, {
    official_min_reqs: sample,
  })
  assert.deepEqual(merged.official_min_reqs, sample)
})

test('statusAfterSuccessfulFetch: ready if either side present', () => {
  assert.equal(statusAfterSuccessfulFetch({ official_min_reqs: sample }, null, null), 'ready')
  assert.equal(statusAfterSuccessfulFetch({}, null, null), 'empty')
  assert.equal(statusAfterSuccessfulFetch({}, sample, null), 'ready')
})

// ---------------------------------------------------------------------------
// shouldEnsureOfficialReqs decision matrix
// ---------------------------------------------------------------------------

test('skip when no steam id', () => {
  const d = shouldEnsureOfficialReqs(baseRow({ steam_app_id: null }))
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'no_steam_id')
})

test('skip when already filled (any side) — v1 no re-fetch for missing secondary', () => {
  const d = shouldEnsureOfficialReqs(
    baseRow({ official_min_reqs: sample, official_rec_reqs: null })
  )
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'already_filled')
})

test('skip empty within TTL', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'empty',
      official_reqs_checked_at: new Date(now - 1000).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'negative_cache')
})

test('fetch empty after TTL expires', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'empty',
      official_reqs_checked_at: new Date(now - OFFICIAL_REQS_EMPTY_TTL_MS - 1).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'fetch')
})

test('skip rate_limited within cooldown', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'rate_limited',
      official_reqs_checked_at: new Date(now - 1000).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'cooldown')
})

test('fetch rate_limited after cooldown', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'rate_limited',
      official_reqs_checked_at: new Date(
        now - OFFICIAL_REQS_RATE_LIMIT_COOLDOWN_MS - 1
      ).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'fetch')
})

test('skip error within cooldown', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'error',
      official_reqs_checked_at: new Date(now - 1000).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'error_cooldown')
})

test('skip pending within TTL', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'pending',
      official_reqs_checked_at: new Date(now - 1000).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'skip')
  if (d.action === 'skip') assert.equal(d.reason, 'in_flight')
})

test('fetch when pending TTL expired', () => {
  const now = Date.now()
  const d = shouldEnsureOfficialReqs(
    baseRow({
      official_reqs_status: 'pending',
      official_reqs_checked_at: new Date(now - OFFICIAL_REQS_PENDING_TTL_MS - 1).toISOString(),
    }),
    now
  )
  assert.equal(d.action, 'fetch')
})

test('fetch when never checked', () => {
  const d = shouldEnsureOfficialReqs(baseRow())
  assert.equal(d.action, 'fetch')
  if (d.action === 'fetch') assert.equal(d.reason, 'never_checked')
})

test('error cooldown constant is 24h', () => {
  assert.equal(OFFICIAL_REQS_ERROR_COOLDOWN_MS, 24 * 60 * 60 * 1000)
})

// ---------------------------------------------------------------------------
// ensureGameOfficialRequirements with mock client + fetch
// ---------------------------------------------------------------------------

function mockClient(row: OfficialReqsGameRow | null) {
  let current = row ? { ...row } : null
  const updates: Record<string, unknown>[] = []

  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                maybeSingle: async () => ({ data: current, error: null }),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch)
          return {
            eq(_col: string, _val: string) {
              return {
                is() {
                  return this
                },
                or() {
                  return this
                },
                select() {
                  return {
                    maybeSingle: async () => {
                      if (current) {
                        current = { ...current, ...patch } as OfficialReqsGameRow
                        return { data: { id: current.id }, error: null }
                      }
                      return { data: null, error: null }
                    },
                  }
                },
                then: undefined as unknown,
                // bare update path (writeOutcome)
              }
            },
          }
        },
      }
    },
  }

  // Patch update().eq() to also resolve as final write without select
  const originalFrom = client.from.bind(client)
  client.from = (table: string) => {
    const builder = originalFrom(table) as ReturnType<typeof originalFrom> & {
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: string) => PromiseLike<{ error: null }> & {
          is: () => unknown
          or: () => unknown
          select: () => { maybeSingle: () => Promise<{ data: { id: string } | null; error: null }> }
        }
      }
    }
    const update = (patch: Record<string, unknown>) => {
      updates.push(patch)
      const chain = {
        eq(_col: string, _val: string) {
          if (current) current = { ...current, ...patch } as OfficialReqsGameRow
          const eqResult = {
            is() {
              return eqResult
            },
            or() {
              return eqResult
            },
            select() {
              return {
                maybeSingle: async () => ({
                  data: current ? { id: current.id } : null,
                  error: null,
                }),
              }
            },
            // Supabase update().eq() returns a promise-like for final write
            then(
              resolve: (v: { error: null }) => unknown,
              reject?: (e: unknown) => unknown
            ) {
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
          return eqResult
        },
      }
      return chain
    }
    return {
      select(cols: string) {
        return builder.select(cols)
      },
      update,
    }
  }

  return {
    client: client as unknown as import('@supabase/supabase-js').SupabaseClient,
    updates,
    getRow: () => current,
  }
}

function okFetch(min: HardwareSpec | null, rec: HardwareSpec | null): FetchSteamOfficialReqsResult {
  return {
    ok: true,
    appId: '12345',
    reqs: { min, rec },
    appFound: true,
    attempts: 1,
  }
}

test('ensure: skip already filled without calling fetch', async () => {
  let fetchCalls = 0
  const { client } = mockClient(baseRow({ official_min_reqs: sample }))
  const result = await ensureGameOfficialRequirements(client, 'test-game', {
    fetchFn: async () => {
      fetchCalls++
      return okFetch(sample, sampleRec)
    },
  })
  assert.equal(fetchCalls, 0)
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'already_filled')
})

test('ensure: fetch and set ready with min+rec', async () => {
  const { client, getRow } = mockClient(baseRow())
  const result = await ensureGameOfficialRequirements(client, 'test-game', {
    fetchFn: async () => okFetch(sample, sampleRec),
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'ready')
  assert.equal(result.fetched, true)
  assert.deepEqual(result.officialMinReqs, sample)
  assert.equal(getRow()?.official_reqs_status, 'ready')
})

test('ensure: empty Steam parse stamps empty', async () => {
  const { client } = mockClient(baseRow())
  const result = await ensureGameOfficialRequirements(client, 'test-game', {
    fetchFn: async () => okFetch(null, null),
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, 'empty')
})

test('ensure: rate limited stamps rate_limited', async () => {
  const { client } = mockClient(baseRow())
  const result = await ensureGameOfficialRequirements(client, 'test-game', {
    fetchFn: async () => ({
      ok: false,
      appId: '12345',
      reqs: { min: null, rec: null },
      appFound: false,
      rateLimited: true,
      error: 'Steam rate limited (429)',
      attempts: 2,
    }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'rate_limited')
})

test('ensure: not found', async () => {
  const { client } = mockClient(null)
  const result = await ensureGameOfficialRequirements(client, 'missing', {
    fetchFn: async () => okFetch(sample, null),
  })
  assert.equal(result.status, 'not_found')
})

test('ensure: second call within empty TTL skips fetch', async () => {
  let fetchCalls = 0
  const now = Date.now()
  const { client } = mockClient(
    baseRow({
      official_reqs_status: 'empty',
      official_reqs_checked_at: new Date(now - 5000).toISOString(),
    })
  )
  const result = await ensureGameOfficialRequirements(client, 'test-game', {
    now,
    fetchFn: async () => {
      fetchCalls++
      return okFetch(sample, null)
    },
  })
  assert.equal(fetchCalls, 0)
  assert.equal(result.status, 'empty')
  assert.equal(result.reason, 'negative_cache')
})

test('ensure: missing steam_app_id is resolved then requirements fetched', async () => {
  let fetchAppId: string | null = null
  let resolveCalls = 0
  const { client, getRow } = mockClient(
    baseRow({ steam_app_id: null, name: 'Red Dead Redemption 2', slug: 'red-dead-redemption-2' })
  )
  const result = await ensureGameOfficialRequirements(client, 'red-dead-redemption-2', {
    resolveSteamAppIdFn: async () => {
      resolveCalls++
      return { steamAppId: '1174180', confidence: 0.96, source: 'static-map' }
    },
    fetchFn: async (appId) => {
      fetchAppId = String(appId)
      return okFetch(sample, sampleRec)
    },
  })
  assert.equal(resolveCalls, 1)
  assert.equal(fetchAppId, '1174180')
  assert.equal(result.status, 'ready')
  assert.equal(String(getRow()?.steam_app_id), '1174180')
})

test('ensure: unresolved steam_app_id skips without fetch', async () => {
  let fetchCalls = 0
  const { client } = mockClient(baseRow({ steam_app_id: null, name: 'VALORANT', slug: 'valorant' }))
  const result = await ensureGameOfficialRequirements(client, 'valorant', {
    resolveSteamAppIdFn: async () => null,
    fetchFn: async () => {
      fetchCalls++
      return okFetch(sample, null)
    },
  })
  assert.equal(fetchCalls, 0)
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'no_steam_id')
})
