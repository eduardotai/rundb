import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  isSyncManagedCover,
  mapSteamItem,
  planCatalogSync,
  steamCoverUrl,
  type CatalogRow,
  type SteamGameInfo,
} from '../lib/catalog-sync/plan'
import { runCatalogSync, snapshotCatalogStore, type CatalogStore, type SteamSnapshot } from '../lib/catalog-sync/run'
import { buildGetItemsUrl, fetchSteamItems, parseSearchAppIds, type FetchLike, type SteamStoreItem } from '../lib/catalog-sync/steam'
import { buildCoverLoaderUrl, extractSteamAppIdFromUrl, upgradeCoverImageSrc } from '../lib/cover-image-url'

const HASHED = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2483190/711e39/library_capsule_2x.jpg'
const LEGACY = 'https://cdn.cloudflare.steamstatic.com/steam/apps/2483190/library_600x900_2x.jpg'
const STORAGE = 'https://x.supabase.co/storage/v1/object/public/game-media/games/crimson-desert/cover.webp'

function item(appid: number, over: Partial<SteamStoreItem> = {}): SteamStoreItem {
  return {
    appid,
    success: 1,
    visible: true,
    type: 0,
    name: `Game ${appid}`,
    basic_info: { developers: [{ name: `Dev ${appid}` }], publishers: [{ name: `Pub ${appid}` }] },
    assets: {
      asset_url_format: `steam/apps/${appid}/\${FILENAME}?t=1793894652`,
      library_capsule_2x: `hash${appid}/library_capsule_2x.jpg`,
      header: `h${appid}/header.jpg`,
    },
    release: { steam_release_date: Date.UTC(2026, 6, 1) / 1000 },
    reviews: { summary_filtered: { review_count: 500 } },
    ...over,
  }
}

function row(over: Partial<CatalogRow> & { slug: string }): CatalogRow {
  return {
    id: `id-${over.slug}`,
    name: over.slug,
    cover_url: null,
    steam_app_id: null,
    release_year: null,
    developer: null,
    publisher: null,
    genres: [],
    ...over,
  }
}

const OPTS = { since: new Date('2026-05-27T00:00:00Z'), now: new Date('2026-11-10T00:00:00Z'), minReviews: 50, maxNew: 100 }

function infoMap(items: SteamStoreItem[]): Map<string, SteamGameInfo> {
  const m = new Map<string, SteamGameInfo>()
  for (const i of items) {
    const info = mapSteamItem(i)
    if (info) m.set(info.appid, info)
  }
  return m
}

// ---------- mapping ----------

test('steamCoverUrl builds the hashed library capsule URL and drops the ?t= cache buster', () => {
  assert.equal(
    steamCoverUrl(item(2483190)),
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2483190/hash2483190/library_capsule_2x.jpg'
  )
})

test('steamCoverUrl falls back to the header only when no library capsule exists', () => {
  const it = item(10, { assets: { asset_url_format: 'steam/apps/10/${FILENAME}', header: 'h/header.jpg' } })
  assert.equal(steamCoverUrl(it), 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/10/h/header.jpg')
  assert.equal(steamCoverUrl(item(10, { assets: {} })), null)
  assert.equal(steamCoverUrl(item(10, { assets: { asset_url_format: 'https://evil.test/${FILENAME}', header: 'x.jpg' } })), null)
})

test('mapSteamItem maps release date, year, developer, publisher, review count', () => {
  const info = mapSteamItem(item(5))!
  assert.equal(info.releaseDate, '2026-07-01')
  assert.equal(info.releaseYear, 2026)
  assert.equal(info.developer, 'Dev 5')
  assert.equal(info.publisher, 'Pub 5')
  assert.equal(info.reviewCount, 500)
  assert.equal(info.isGame, true)
  assert.equal(mapSteamItem(item(5, { success: 2 })), null)
})

test('isSyncManagedCover owns empty and Steam CDN covers only', () => {
  assert.equal(isSyncManagedCover(null), true)
  assert.equal(isSyncManagedCover(''), true)
  assert.equal(isSyncManagedCover(LEGACY), true)
  assert.equal(isSyncManagedCover(HASHED), true)
  assert.equal(isSyncManagedCover(STORAGE), false)
  assert.equal(isSyncManagedCover('https://images.igdb.com/igdb/image/upload/t_original/x.jpg'), false)
})

// ---------- planning ----------

test('plan replaces stale Steam covers, keeps curated covers, and only fills empty metadata', () => {
  const rows = [
    row({ slug: 'forza-horizon-6', steam_app_id: '2483190', cover_url: LEGACY }),
    row({ slug: 'crimson-desert', steam_app_id: '3321460', cover_url: STORAGE, developer: 'Pearl Abyss', release_year: 2026 }),
    row({ slug: 'no-cover', steam_app_id: '7', cover_url: null }),
  ]
  const plan = planCatalogSync(rows, infoMap([item(2483190), item(3321460), item(7)]), [], OPTS)
  const byslug = Object.fromEntries(plan.updates.map((u) => [u.slug, u]))
  assert.match(byslug['forza-horizon-6'].patch.cover_url!, /store_item_assets\/steam\/apps\/2483190\/hash2483190\//)
  assert.equal(byslug['forza-horizon-6'].expectedCoverUrl, LEGACY)
  assert.equal(byslug['crimson-desert'].patch.cover_url, undefined, 'curated Storage cover untouched')
  assert.equal(byslug['crimson-desert'].patch.developer, undefined, 'existing developer never overwritten')
  assert.equal(byslug['crimson-desert'].patch.release_year, undefined)
  assert.equal(byslug['crimson-desert'].patch.publisher, 'Pub 3321460')
  assert.equal(plan.stats.coverFixes, 2)
  assert.equal(plan.stats.coverFixesFromEmpty, 1)
  for (const u of plan.updates) {
    assert.deepEqual(
      Object.keys(u.patch).filter((k) => !['cover_url', 'release_year', 'developer', 'publisher', 'genres'].includes(k)),
      [],
      'sync never writes name/slug/report_count/etc.'
    )
  }
})

test('plan skips rows that share a Steam app id and rows Steam no longer lists', () => {
  const rows = [
    row({ slug: 'hades-2', steam_app_id: '1145350' }),
    row({ slug: 'hades-ii', steam_app_id: '1145350' }),
    row({ slug: 'delisted', steam_app_id: '99' }),
    row({ slug: 'valorant' }),
  ]
  const plan = planCatalogSync(rows, infoMap([item(1145350), item(99, { visible: false })]), [], OPTS)
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.skipped.duplicateAppIds, [{ appid: '1145350', slugs: ['hades-2', 'hades-ii'] }])
  assert.deepEqual(plan.skipped.notOnSteam, ['delisted'])
  assert.deepEqual(plan.skipped.noSteamAppId, ['valorant'])
})

test('plan adds only notable, released games newer than --since that are not in the catalog', () => {
  const rows = [row({ slug: 'game-1', steam_app_id: '1' }), row({ slug: 'game-2', steam_app_id: '999' })]
  const steam = infoMap([
    item(1), // already in catalog
    item(2, { name: 'Game 1' }), // slug collision with existing row -> suffixed
    item(3, { reviews: { summary_filtered: { review_count: 10 } } }), // not notable
    item(4, { release: { steam_release_date: Date.UTC(2026, 0, 1) / 1000 } }), // before since
    item(5, { release: { steam_release_date: Date.UTC(2026, 11, 1) / 1000, is_coming_soon: true } }), // unreleased
    item(6, { type: 4 }), // DLC
    item(7, { reviews: { summary_filtered: { review_count: 9000 } } }),
  ])
  const plan = planCatalogSync(rows, steam, ['1', '2', '3', '4', '5', '6', '7'], OPTS)
  assert.deepEqual(plan.inserts.map((g) => [g.slug, g.steam_app_id]), [['game-7', '7'], ['game-1-2', '2']])
  assert.equal(plan.inserts[0].ingest_status, 'skeleton')
  assert.equal(planCatalogSync(rows, steam, ['7', '2'], { ...OPTS, maxNew: 1 }).inserts.length, 1)
})

// ---------- run (mocked network + in-memory store) ----------

function memoryStore(initial: CatalogRow[]) {
  const rows = initial.map((r) => ({ ...r }))
  const runs: unknown[] = []
  const writes = { updates: 0, inserts: 0 }
  const store: CatalogStore = {
    listGames: async () => rows.map((r) => ({ ...r })),
    async updateGame(id, patch, expected) {
      const r = rows.find((x) => x.id === id)!
      if ('cover_url' in patch && r.cover_url !== expected) return false
      const { last_synced_at: _s, ...rest } = patch
      Object.assign(r, rest)
      writes.updates++
      return true
    },
    async insertGames(newRows) {
      let n = 0
      for (const nr of newRows) {
        if (rows.some((r) => r.slug === nr.slug)) continue
        rows.push({ id: `id-${nr.slug}`, ...nr })
        n++
      }
      writes.inserts += n
      return n
    },
    async logRun(run) {
      runs.push(run)
    },
  }
  return { store, rows, runs, writes }
}

function mockSteamFetch(items: SteamStoreItem[], popularNew: number[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchLike = async (url) => {
    calls.push(url)
    if (url.includes('IStoreBrowseService/GetItems')) {
      const input = JSON.parse(decodeURIComponent(url.split('input_json=')[1])) as { ids: { appid: number }[] }
      const wanted = new Set(input.ids.map((i) => i.appid))
      return Response.json({ response: { store_items: items.filter((i) => wanted.has(i.appid!)) } })
    }
    if (url.includes('/search/results/')) {
      return Response.json({ total_count: popularNew.length, results_html: popularNew.map((id) => `<a data-ds-appid="${id}">`).join('') })
    }
    if (url.includes('/api/appdetails')) {
      const id = new URL(url).searchParams.get('appids')!
      return Response.json({ [id]: { success: true, data: { genres: [{ description: 'Action' }] } } })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch, calls }
}

test('apply run fixes covers, adds new games, logs the run, and a second run is a no-op', async () => {
  const mem = memoryStore([
    { ...row({ slug: 'forza-horizon-6', steam_app_id: '2483190', cover_url: LEGACY }), report_count: 1 } as CatalogRow,
    row({ slug: 'crimson-desert', steam_app_id: '3321460', cover_url: STORAGE }),
  ])
  const net = mockSteamFetch([item(2483190), item(3321460), item(42, { name: 'New Hit' })], [42])
  const steam = { fetch: net.fetch, sleep: async () => {} }
  const base = { store: mem.store, mode: 'apply' as const, since: OPTS.since, now: OPTS.now, steam }

  const first = await runCatalogSync(base)
  assert.equal(first.applied.inserted, 1)
  assert.equal(first.applied.conflicts, 0)
  assert.equal(mem.rows.find((r) => r.slug === 'new-hit')?.genres?.[0], 'Action')
  assert.match(mem.rows.find((r) => r.slug === 'forza-horizon-6')!.cover_url!, /store_item_assets/)
  assert.equal(mem.rows.find((r) => r.slug === 'crimson-desert')!.cover_url, STORAGE)
  assert.equal((mem.rows.find((r) => r.slug === 'forza-horizon-6') as unknown as { report_count: number }).report_count, 1)
  assert.equal(mem.runs.length, 1)

  const writesAfterFirst = { ...mem.writes }
  const second = await runCatalogSync(base)
  assert.equal(second.plan.updates.length, 0, 'idempotent: nothing left to update')
  assert.equal(second.plan.inserts.length, 0, 'idempotent: nothing left to insert')
  assert.deepEqual(mem.writes, writesAfterFirst)
})

test('dry run never writes (read-only snapshot store would throw) and replays a cached Steam fetch', async () => {
  const rows = [row({ slug: 'forza-horizon-6', steam_app_id: '2483190', cover_url: LEGACY })]
  const snapshot: SteamSnapshot = { fetchedAt: 'x', items: [item(2483190)], candidateAppIds: [], genres: {} }
  const res = await runCatalogSync({ store: snapshotCatalogStore(rows), mode: 'dry-run', since: OPTS.since, now: OPTS.now, steam: { snapshot } })
  assert.equal(res.plan.stats.coverFixes, 1)
  assert.deepEqual(res.applied, { updated: 0, conflicts: 0, inserted: 0, failed: 0 })
})

test('a cover changed by someone else after planning is not clobbered', async () => {
  const mem = memoryStore([row({ slug: 'g', steam_app_id: '5', cover_url: LEGACY })])
  const original = mem.store.updateGame
  mem.store.updateGame = async (id, patch, expected) => {
    mem.rows[0].cover_url = STORAGE // admin edit lands between read and write
    return original(id, patch, expected)
  }
  const res = await runCatalogSync({
    store: mem.store,
    mode: 'apply',
    since: OPTS.since,
    now: OPTS.now,
    steam: { snapshot: { fetchedAt: 'x', items: [item(5)], candidateAppIds: [], genres: {} } },
  })
  assert.equal(res.applied.conflicts, 1)
  assert.equal(mem.rows[0].cover_url, STORAGE)
})

test('fetchSteamItems batches 100 ids per call and retries a 429', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => String(i + 1))
  let calls = 0
  let throttled = false
  const fetch: FetchLike = async (url) => {
    calls++
    if (!throttled) {
      throttled = true
      return new Response('slow down', { status: 429 })
    }
    const input = JSON.parse(decodeURIComponent(url.split('input_json=')[1])) as { ids: { appid: number }[] }
    assert.ok(input.ids.length <= 100)
    return Response.json({ response: { store_items: input.ids.map((i) => item(i.appid)) } })
  }
  const got = await fetchSteamItems(ids, { fetch, sleep: async () => {} })
  assert.equal(got.size, 250)
  assert.equal(calls, 4) // 3 batches + 1 retry
  assert.ok(buildGetItemsUrl(['1']).startsWith('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json='))
  assert.deepEqual(parseSearchAppIds('<a data-ds-appid="1"></a><a data-ds-appid="2"></a><a data-ds-appid="1">'), ['1', '2'])
})

// ---------- display helpers (root causes of the blank covers) ----------

test('hashed Steam store-asset URLs are never rewritten back to the guessed legacy path', () => {
  assert.equal(upgradeCoverImageSrc(HASHED, '2483190'), HASHED)
  assert.equal(extractSteamAppIdFromUrl(HASHED), '2483190')
  // Legacy URLs keep their old normalization.
  assert.equal(
    upgradeCoverImageSrc('https://cdn.cloudflare.steamstatic.com/steam/apps/10/header.jpg'),
    'https://cdn.cloudflare.steamstatic.com/steam/apps/10/library_600x900_2x.jpg'
  )
})

test('Storage covers load the public object unless Image Transformations are enabled', () => {
  assert.equal(buildCoverLoaderUrl(STORAGE, 640, 90), STORAGE, 'default: /object/public (render/image is 403 without the add-on)')
  assert.match(buildCoverLoaderUrl(STORAGE, 640, 90, true), /\/storage\/v1\/render\/image\/public\/.*width=640/)
})

test('next.config allows the hashed Steam asset host', () => {
  const src = readFileSync('next.config.ts', 'utf8')
  assert.match(src, /hostname: 'shared\.akamai\.steamstatic\.com',\s*pathname: '\/store_item_assets\/steam\/apps\/\*\*'/)
})
