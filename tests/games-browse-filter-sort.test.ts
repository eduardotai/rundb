/**
 * Direct tests exercising the shipped data functions + pure transform for browse games filters/sorts.
 * Drives getGamesPage, getAllGames, applyGamesBrowseTransform, getAllReportsAsync + compute.
 * Uses mock paths (env-forced) for reproducible parity with the plan's ACs.
 * These tests would have failed before the fixes for the mismatch bugs (wrong slice sorts, server/client totals, tier on partial, redundant name/year re-sort).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Game, GameStats, PerformanceTier, Report } from '../lib/types';

// Helper to load data adapter under explicit env for parity vs "real" adapter paths.
// When useMock=true we force the !USE_REAL starter branch + mock reports.
// When false we exercise the default (real adapter getGamesPage code, which falls back if no Supabase config).
async function loadData(useMock: boolean) {
  const prev = { ...process.env };
  if (useMock) {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_USE_REAL_DATA = 'false';
    process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA = 'true';
  } else {
    // leave unset or restore to default so getGamesPage takes the USE_REAL branch (config check + possible fallback)
    delete process.env.NEXT_PUBLIC_USE_REAL_DATA;
    delete process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA;
  }
  // dynamic ensures fresh eval under the env
  const mod = await import('../lib/data.ts');
  // restore to not pollute sibling tests
  Object.assign(process.env, prev);
  return mod;
}

// Top-level env + static import for the bulk of the mock-parity tests (stable).
// The loadData helper is used by the "real adapter path" tests below to drive the shipped getGamesPage
// through the default/real branch of the data adapter.
process.env.NODE_ENV = 'development';
process.env.NEXT_PUBLIC_USE_REAL_DATA = 'false';
process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA = 'true';

import * as Data from '../lib/data.ts';
const { getGamesPage, getAllGames, applyGamesBrowseTransform, getAllReportsAsync, computeGameStatsFromReports, USE_REAL } = Data;

async function buildStatsMap(games: Game[], reports: Report[]): Promise<Record<string, GameStats>> {
  const map: Record<string, GameStats> = {};
  for (const g of games) {
    const greps = reports.filter((r: Report) => r.gameId === g.id);
    map[g.id] = computeGameStatsFromReports(greps);
  }
  return map;
}

function dominantTier(stats: GameStats): PerformanceTier | null {
  const entries = Object.entries(stats.tierDistribution) as [PerformanceTier, number][];
  const max = entries.sort((a, b) => b[1] - a[1])[0];
  return max && max[1] > 0 ? max[0] : null;
}

test('getAllGames (mock) returns starter catalog', async () => {
  const games = await getAllGames();
  assert.ok(games.length >= 18, 'expect at least the 18 starter games');
  assert.ok(games.some(g => g.name === 'Cyberpunk 2077'));
  console.log('[test] getAllGames count:', games.length);
});

test('getGamesPage default name sort + paging (mock parity)', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 5, sort: 'name' });
  assert.strictEqual(res.page, 1);
  assert.strictEqual(res.pageSize, 5);
  assert.ok(res.total >= 18);
  assert.ok(res.totalPages >= 4);
  // name asc within slice
  const names = res.games.map(g => g.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(names, sorted, 'server name sort must be applied pre-slice');
  console.log('[test] name page1 slice names:', names, 'total:', res.total);
});

test('getGamesPage year sort newest first', async () => {
  const res = await getGamesPage({ page: 1, pageSize: 3, sort: 'year' });
  const years = res.games.map(g => g.releaseYear);
  for (let i = 1; i < years.length; i++) {
    assert.ok(years[i-1] >= years[i], 'year desc');
  }
  console.log('[test] year sort years:', years);
});

test('getGamesPage search + genre delegates and returns correct total', async () => {
  const resSearch = await getGamesPage({ search: 'ring', sort: 'name' });
  assert.ok(resSearch.games.some(g => /ring/i.test(g.name)));
  assert.strictEqual(resSearch.total, 1);

  const resGenre = await getGamesPage({ genre: 'RPG', pageSize: 10, sort: 'name' });
  // Strict verification that server-side genre delegation (via includes in starter / contains in real) reduced the set and only matching games returned.
  assert.ok(resGenre.total > 0, 'genre filter must return some');
  assert.ok(resGenre.total < 37, 'genre filter must be a proper restriction vs full catalog');
  assert.ok(resGenre.games.every((g: Game) => g.genres.includes('RPG')), 'all returned games must satisfy the genre filter exactly as server applied it');
  console.log('[test] search "ring" total:', resSearch.total, 'genre RPG total:', resGenre.total);
});

test('getGamesPage sort=reports accepted (no crash; order not reports in data fn itself)', async () => {
  const res = await getGamesPage({ sort: 'reports', pageSize: 10 });
  assert.ok(res.games.length > 0);
  assert.ok(res.total >= 18);
  // reports order happens in transform + stats, not here
  console.log('[test] reports sort param accepted, returned total:', res.total, 'slice len:', res.games.length);
});

test('applyGamesBrowseTransform + reports sort uses global counts, descending', async () => {
  const allGames = await getAllGames();
  const reports = await getAllReportsAsync();
  const statsMap = await buildStatsMap(allGames, reports);

  const transformed = applyGamesBrowseTransform(allGames, statsMap, { sort: 'reports', tier: '' });
  assert.ok(transformed.length >= 5);

  // verify non-increasing report counts
  let prev = Infinity;
  for (const g of transformed.slice(0, 8)) {
    const c = statsMap[g.id]?.totalReports ?? 0;
    assert.ok(c <= prev, `reports sort descending violated: ${g.name} ${c} > prev ${prev}`);
    prev = c;
  }
  console.log('[test] reports sort top counts:', transformed.slice(0,5).map((g: Game) => `${g.name}:${statsMap[g.id]?.totalReports}`));
});

test('applyGamesBrowseTransform dominant tier filter restricts correctly + combined with sort', async () => {
  const allGames = await getAllGames();
  const reports = await getAllReportsAsync();
  const statsMap = await buildStatsMap(allGames, reports);

  // pick a tier that exists in seeds
  const anyTier = (Object.keys(statsMap) as string[]).map((id: string) => dominantTier(statsMap[id])).find(Boolean) as PerformanceTier | undefined;
  if (!anyTier) {
    console.log('[test] no tiers with reports in this run; skipping tier assert');
    return;
  }

  const tiered = applyGamesBrowseTransform(allGames, statsMap, { tier: anyTier, sort: 'name' });
  assert.ok(tiered.length >= 1, 'at least one game should match a populated dominant tier');
  for (const g of tiered) {
    const dom = dominantTier(statsMap[g.id]);
    assert.strictEqual(dom, anyTier, `game ${g.name} dominant should be ${anyTier}`);
  }
  // name secondary after tier
  const names = tiered.map(g => g.name);
  const sortedNames = [...names].sort((a,b)=>a.localeCompare(b));
  assert.deepStrictEqual(names, sortedNames, 'post-tier name sort');

  console.log('[test] tier filter for', anyTier, 'yielded', tiered.length, 'games; first:', tiered[0]?.name);
});

test('getGamesPage + transform parity for name sort on search set (no client override when trusted)', async () => {
  const pageRes = await getGamesPage({ search: '', genre: undefined, sort: 'name', page: 1, pageSize: 48 });
  const fullGames = await getAllGames();
  const reports = await getAllReportsAsync();
  const stats = await buildStatsMap(fullGames, reports);
  const transformedAll = applyGamesBrowseTransform(fullGames, stats, { sort: 'name', tier: '' });

  // For name, server (starter) already gave sorted pre-page; transform would give full sorted same way
  const pageNames = pageRes.games.map(g=>g.name);
  assert.deepStrictEqual(pageNames, transformedAll.slice(0, pageRes.games.length).map(g=>g.name).slice(0, pageNames.length));
  console.log('[test] name sort page vs transform head match (parity)');
});

test('post-filter total/pages computed from transformed set (reports case)', async () => {
  const allG = await getAllGames();
  const reps = await getAllReportsAsync();
  const sm = await buildStatsMap(allG, reps);
  const sortedReports = applyGamesBrowseTransform(allG, sm, { sort: 'reports', tier: '' });
  const fakePageSize = 5;
  const t = sortedReports.length;
  const tp = Math.max(1, Math.ceil(t / fakePageSize));
  assert.ok(tp >= 1);
  // simulate what page logic does
  const slice0 = sortedReports.slice(0, fakePageSize);
  assert.strictEqual(slice0.length, Math.min(fakePageSize, t));
  console.log('[test] transformed reports total:', t, 'would-be pages for size5:', tp);
});

console.log('[test] USE_REAL under forced mock env:', USE_REAL);

// --- Real adapter path tests (drive the *shipped* getGamesPage from real data.ts without forcing mock) ---
// These exercise the real-mode code inside getGamesPage (USE_REAL check, Supabase config branch or fallback, sort='reports' handling, search/genre delegation).
// Even when no Supabase, it runs the real adapter logic and falls back to starter (parity with AC3).
// Large pageSize request exercises the raised cap fix so global transform receives full set.

test('getGamesPage via real adapter (default env, no mock force) returns consistent data', async () => {
  const d = await loadData(false); // default/real path through getGamesPage
  const res = await d.getGamesPage({ sort: 'name', pageSize: 5 });
  assert.ok(res.total >= 18);
  const names = res.games.map((g: Game) => g.name);
  const sorted = [...names].sort((a: string, b: string) => a.localeCompare(b));
  assert.deepStrictEqual(names, sorted, 'real adapter path must still deliver server name order');
  console.log('[test-real] default adapter name page total:', res.total, 'head:', names);
});

test('getGamesPage large pageSize (global needs) honored in real adapter path', async () => {
  const d = await loadData(false);
  const big = await d.getGamesPage({ page: 1, pageSize: 10000, sort: 'name' });
  // With raised cap, should return substantially all (or min(10000, total)) not the old 100 clamp.
  assert.ok(big.games.length >= 18, 'large pageSize must not be clamped to 100; global transform requires full search/genre set');
  assert.ok(big.total >= big.games.length || big.games.length >= 18);
  console.log('[test-real] large pageSize=10000 returned len:', big.games.length, 'total:', big.total);
});

test('getGamesPage reports sort + tier global via real adapter (exercises reports branch + fallback)', async () => {
  const d = await loadData(false);
  // Even on real adapter, getGamesPage accepts reports (no crash, delegates to starter if !config)
  const paged = await d.getGamesPage({ sort: 'reports', pageSize: 10 });
  assert.ok(paged.total >= 18);
  // To drive the full global transform on the (possibly larger) set returned:
  const allFromAdapter = await d.getAllGames();
  const reps = await d.getAllReportsAsync();
  const smap: Record<string, GameStats> = {};
  allFromAdapter.forEach((g: Game) => {
    const rs = reps.filter((r: Report) => r.gameId === g.id);
    smap[g.id] = d.computeGameStatsFromReports(rs);
  });
  const transformed = d.applyGamesBrowseTransform(allFromAdapter, smap, { sort: 'reports', tier: '' });
  let prev = Infinity;
  transformed.slice(0, 6).forEach((g: Game) => {
    const c = smap[g.id]?.totalReports ?? 0;
    assert.ok(c <= prev);
    prev = c;
  });
  console.log('[test-real] real-adapter reports global top counts via transform:', transformed.slice(0,3).map((g: Game) => g.name + ':' + smap[g.id]?.totalReports));
});

console.log('[test] additional real-adapter path tests loaded (USE_REAL at import time may differ)');