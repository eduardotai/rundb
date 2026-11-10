/**
 * Data honesty fixes found by checking the UI against the production data shape
 * (10k-game catalog, few reports, PostgREST 1,000-row cap, empty "this week" window).
 * Run: npx tsx --test tests/data-honesty.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GPU_SERIES_FILTER_OPTIONS, gpuMatchesSeries } from '../lib/gpu-series'
import { filterReports } from '../lib/data-logic'
import { getAllHardwareCatalog } from '../lib/hardware-catalog'
import {
  DataUnavailableError,
  escapeIlike,
  fetchApprovedReportRowsForGames,
  fetchGlobalCounts,
  fetchReportedGameRows,
  fetchSearchGameRows,
} from '../lib/data-queries'
import { recentReportsBadge, trendingHeading } from '../lib/trending'
import type { Report } from '../lib/types'

// ---------- GPU series ----------

test('GPU series filter matches AMD/Intel by catalog series, not substring', () => {
  const cases: Array<[string, string, boolean]> = [
    ['AMD Radeon RX 7800 XT', 'RDNA 3', true],
    ['RX 6700 XT', 'RDNA 2', true],
    ['AMD Radeon RX 9070 XT', 'RDNA 4', true],
    ['Intel Arc B580', 'Arc Battlemage', true],
    ['AMD Radeon RX 7800 XT', 'RDNA 2', false],
    ['NVIDIA GeForce RTX 4070 Ti', 'RTX 40', true],
    ['NVIDIA GeForce RTX 5080', 'RTX 50', true],
    ['NVIDIA GeForce RTX 5080', 'RTX 40', false],
    ['NVIDIA GeForce GTX 1660 Super', 'GTX 16', true],
    // Unresolvable strings fall back to the model-number rule.
    ['NVIDIA GeForce RTX 4090 Laptop GPU', 'RTX 40', true],
    // Legacy model-number labels.
    ['AMD Radeon RX 7800 XT', 'RX 7000', true],
    ['AMD Radeon RX 6700 XT', 'RX 7000', false],
    ['AMD Radeon RX 580', 'RX 500', true],
    // Model filters from /reports keep substring semantics.
    ['AMD Radeon RX 7800 XT', 'RX 7800 XT', true],
    ['NVIDIA GeForce RTX 3060', 'RX 7800 XT', false],
  ]
  for (const [gpu, series, expected] of cases) {
    assert.equal(gpuMatchesSeries(gpu, series), expected, `${gpu} vs ${series}`)
  }
})

test('every game-detail GPU series option matches at least one catalog GPU', () => {
  const gpus = getAllHardwareCatalog().filter((e) => e.componentType === 'gpu')
  for (const opt of GPU_SERIES_FILTER_OPTIONS) {
    const hit = gpus.some((e) => gpuMatchesSeries(e.canonical, opt.value))
    assert.ok(hit, `no catalog GPU matches option ${opt.value}`)
  }
  const values = GPU_SERIES_FILTER_OPTIONS.map((o) => o.value)
  for (const v of ['RTX 50', 'RDNA 4']) assert.ok(values.includes(v), `missing ${v}`)
})

function report(partial: Partial<Report>): Report {
  return {
    id: partial.id ?? 'r',
    gameId: 'g',
    gameName: 'G',
    cpu: 'AMD Ryzen 7 7800X3D',
    gpu: 'AMD Radeon RX 7800 XT',
    ram: 32,
    resolution: '2560x1440',
    settingsPreset: 'High',
    avgFps: 90,
    performanceTier: 'Excellent',
    createdAt: new Date(0).toISOString(),
    helpfulVotes: 0,
    status: 'approved',
    ...partial,
  } as Report
}

test('filterReports applies tier (was ignored in real mode) and catalog GPU series', () => {
  const reports = [
    report({ id: 'a', performanceTier: 'Excellent', gpu: 'AMD Radeon RX 7800 XT' }),
    report({ id: 'b', performanceTier: 'Playable', gpu: 'NVIDIA GeForce RTX 4070' }),
  ]
  assert.deepEqual(filterReports(reports, { tier: 'Playable' }).map((r) => r.id), ['b'])
  assert.deepEqual(filterReports(reports, { gpuSeries: 'RDNA 3' }).map((r) => r.id), ['a'])
})

// ---------- search escaping ----------

test('escapeIlike escapes LIKE wildcards and drops PostgREST *', () => {
  assert.equal(escapeIlike('100%'), '100\\%')
  assert.equal(escapeIlike('a_b'), 'a\\_b')
  assert.equal(escapeIlike('back\\slash'), 'back\\\\slash')
  assert.equal(escapeIlike('half*life'), 'half life')
  assert.equal(escapeIlike('  cyberpunk  '), 'cyberpunk')
})

// ---------- fake PostgREST client ----------

interface Call {
  table: string
  ops: Array<[string, unknown[]]>
}

function fakeClient(respond: (call: Call) => { data?: unknown; error?: unknown; count?: number | null }) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const builder: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'gt', 'gte', 'in', 'ilike', 'contains', 'order', 'range', 'limit']) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args])
          return builder
        }
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => ({ data: null, error: null, count: null, ...respond(call) }))
          .then(resolve, reject)
      return builder
    },
  }
  return { client, calls }
}

const has = (call: Call, op: string, ...args: unknown[]) =>
  call.ops.some(([o, a]) => o === op && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args))

test('fetchGlobalCounts returns games with reports, not just the catalog size', async () => {
  const { client } = fakeClient((call) => {
    if (call.table === 'reports') return { count: 8 }
    if (has(call, 'gt', 'report_count', 0)) return { count: 7 }
    return { count: 10035 }
  })
  assert.deepEqual(await fetchGlobalCounts(client), { totalGames: 10035, totalReports: 8, gamesWithReports: 7 })
})

test('fetchGlobalCounts throws instead of returning zeros on a Supabase error', async () => {
  const { client } = fakeClient((call) => (call.table === 'reports' ? { error: { message: 'boom' } } : { count: 1 }))
  await assert.rejects(fetchGlobalCounts(client), DataUnavailableError)
})

test('fetchReportedGameRows pages past the 1,000-row cap and only asks for reported games', async () => {
  const { client, calls } = fakeClient((call) => {
    const range = call.ops.find(([o]) => o === 'range')?.[1] as [number, number]
    const size = range[0] === 0 ? 1000 : 5
    return { data: Array.from({ length: size }, (_, i) => ({ id: `${range[0] + i}` })) }
  })
  const rows = await fetchReportedGameRows(client, { search: '100%', genre: 'Shooter' })
  assert.equal(rows.length, 1005)
  assert.equal(calls.length, 2)
  for (const c of calls) {
    assert.ok(has(c, 'gt', 'report_count', 0))
    assert.ok(has(c, 'ilike', 'name', '%100\\%%'))
    assert.ok(has(c, 'contains', 'genres', ['Shooter']))
  }
})

test('fetchApprovedReportRowsForGames chunks ids and reads approved reports only', async () => {
  const { client, calls } = fakeClient(() => ({ data: [{ id: 'r' }] }))
  const ids = Array.from({ length: 400 }, (_, i) => `g${i}`)
  const rows = await fetchApprovedReportRowsForGames(client, ids)
  assert.equal(calls.length, 3)
  assert.equal(rows.length, 3)
  for (const c of calls) {
    assert.ok(has(c, 'eq', 'status', 'approved'))
    const inArgs = c.ops.find(([o]) => o === 'in')?.[1] as [string, string[]]
    assert.ok(inArgs[1].length <= 150)
  }
})

test('fetchReportedGameRows throws on error', async () => {
  const { client } = fakeClient(() => ({ error: { message: 'down' } }))
  await assert.rejects(fetchReportedGameRows(client), DataUnavailableError)
})

// ---------- search_games RPC ----------

function fakeRpc(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return { data: result.data ?? null, error: result.error ?? null }
      },
    },
  }
}

test('search uses the ranked search_games RPC with trimmed text and a clamped limit', async () => {
  const { client, calls } = fakeRpc({ data: [{ id: 'g1', name: 'Cyberpunk 2077' }] })
  const rows = await fetchSearchGameRows(client, '  cyber  ', 500)
  assert.deepEqual(rows, [{ id: 'g1', name: 'Cyberpunk 2077' }])
  assert.deepEqual(calls, [{ fn: 'search_games', args: { q: 'cyber', max_results: 50 } }])
  await fetchSearchGameRows(client, 'x'.repeat(300), 0)
  assert.deepEqual(calls[1].args, { q: 'x'.repeat(100), max_results: 1 })
})

test('search sends wildcards raw (the RPC escapes them) and skips empty text', async () => {
  const { client, calls } = fakeRpc({ data: [] })
  await fetchSearchGameRows(client, '100%', 8)
  assert.equal(calls[0].args.q, '100%')
  assert.deepEqual(await fetchSearchGameRows(client, '   ', 8), [])
  assert.equal(calls.length, 1)
})

test('search throws instead of returning an empty list when the RPC fails', async () => {
  const { client } = fakeRpc({ error: { message: 'function public.search_games does not exist' } })
  await assert.rejects(fetchSearchGameRows(client, 'cyber', 8), DataUnavailableError)
})

// ---------- trending copy ----------

test('trending heading is honest when the 7-day window is empty', () => {
  assert.equal(trendingHeading({}), 'Most active')
  assert.equal(trendingHeading({ a: 0 }), 'Most active')
  assert.equal(trendingHeading({ a: 2 }), 'Trending this week')
  assert.equal(recentReportsBadge({ a: 2 }, 'a'), '+2 this week')
  assert.equal(recentReportsBadge({ a: 2 }, 'b'), null)
})

// ---------- home copy guard ----------

test('home page derives the trending heading from real activity and shows real counts', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
  assert.match(src, /trendingHeading\(recentCounts\)/)
  assert.match(src, /gamesWithReports/)
  assert.doesNotMatch(src, />\s*Trending this week\s*</, 'heading must not be hard-coded')
  assert.doesNotMatch(src, /label: 'reports per game'/, 'a rounded per-game average reads as 0 on the real catalog')
})

test('game detail credits sourced cover art (coverAttribution) next to the hero', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../app/games/[slug]/page.tsx', import.meta.url), 'utf8')
  assert.match(src, /\{game\.coverAttribution\}/)
  assert.match(src, /GPU_SERIES_FILTER_OPTIONS/, 'GPU filter options come from the hardware catalog series')
})

test('reports browser does not claim "every" report and discloses the newest-N cap', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../app/reports/page.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /every community report/i)
  assert.match(src, /GLOBAL_REPORTS_CAP/)
  const data = readFileSync(new URL('../lib/data.ts', import.meta.url), 'utf8')
  assert.match(data, /\.limit\(GLOBAL_REPORTS_CAP\)/)
})

test('copy matches behaviour: name-only search, rig storage, moderation reason for owners', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  // Server search matches names only (ilike on games.name / search_games RPC).
  assert.doesNotMatch(read('app/games/page.tsx'), /games or developers/)
  // Guests' rigs live in this browser; only signed-in rigs sync to the account.
  for (const p of ['app/page.tsx', 'app/compatibility/page.tsx']) {
    assert.doesNotMatch(read(p), /syncs to your account'|stays with your account/, p)
  }
  // Report writes require a registered (non-anonymous) user, see lib/server/report-write.ts.
  assert.doesNotMatch(read('app/auth/sign-in/page.tsx'), /Guests can submit reports/)
  // My reports shows why a report was held or rejected.
  assert.match(read('lib/server/profile.ts'), /status, moderator_notes,/)
  assert.match(read('components/profile/profile-reports-list.tsx'), /r\.moderatorNotes/)
  // Unknown release year is stored as 0 and must not be shown as "0".
  assert.doesNotMatch(read('app/reports/page.tsx'), /hint: String\(g\.releaseYear\)/)
})
