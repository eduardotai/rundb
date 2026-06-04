# Trending Games = Recent Report Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home page "Trending right now" section rank games by how many new reports they received in the last 7 days, topping up with all-time leaders so it always shows 6 cards.

**Architecture:** A new pure ranking helper (`lib/trending.ts`) is unit-tested in isolation. The existing unused `getTrendingGamesAsync` in `lib/data.ts` is rewritten to gather lightweight Supabase data, rank it via the helper, hydrate the chosen game rows, and return `{ games, recentCounts }`. `app/page.tsx` swaps its all-games + all-reports derivation for this single adapter, sources card stats from the batched `getReportsForGamesAsync`, and sources hero counts from `getGlobalCountsAsync`.

**Tech Stack:** Next.js (custom build — see `node_modules/next/dist/docs/`), React Query (`@tanstack/react-query`), Supabase JS client, TypeScript. Tests use Node's built-in runner (`node:test` + `node:assert/strict`) run via `tsx --test`.

---

## Spec reference

`docs/superpowers/specs/2026-06-04-trending-games-recent-reports-design.md`

## File structure

- **Create:** `lib/trending.ts` — pure ranking: count recent reports per game, sort, top-up from fallback sample. No Supabase / React imports.
- **Create:** `lib/trending.test.ts` — unit tests for the pure helper.
- **Modify:** `lib/data.ts` — rewrite `getTrendingGamesAsync` to return `{ games, recentCounts }` using the helper + Supabase; add the `TrendingResult` / `TrendingRankRow` types.
- **Modify:** `app/page.tsx` — replace the two queries + two `useMemo`s with trending-games / trending-stats / global-counts queries; repoint loading/empty/error conditions.

## Conventions to follow (already in the repo)

- Adapter functions in `lib/data.ts` are defensive: never throw, `console.error`/`console.warn` on failure, fall back to `publicStarterGames()`. Match that exactly.
- Supabase reads use `await import('@/lib/supabase/client')` then `createClient()`, and wrap the main query in `withSupabaseReadTimeout(...)`.
- Real-mode gate: `if (USE_REAL && isSupabaseConfigured()) { ... }` else starter/mock fallback.
- Run a single test file with: `npx tsx --test lib/trending.test.ts`

---

## Task 1: Pure trending-rank helper

**Files:**
- Create: `lib/trending.ts`
- Test: `lib/trending.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/trending.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { rankTrendingGameIds, type TrendingRankRow } from './trending'

function row(gameId: string, createdAt: string): TrendingRankRow {
  return { gameId, createdAt }
}

test('ranks games by recent report count, descending', () => {
  const recent: TrendingRankRow[] = [
    row('a', '2026-06-01T00:00:00Z'),
    row('a', '2026-06-02T00:00:00Z'),
    row('b', '2026-06-03T00:00:00Z'),
    row('a', '2026-06-04T00:00:00Z'),
    row('b', '2026-06-04T00:00:00Z'),
    row('c', '2026-06-01T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 6)
  assert.deepEqual(result.ids, ['a', 'b', 'c'])
  assert.deepEqual(result.recentCounts, { a: 3, b: 2, c: 1 })
})

test('breaks count ties by most recent report first', () => {
  const recent: TrendingRankRow[] = [
    row('old', '2026-06-01T00:00:00Z'),
    row('new', '2026-06-05T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 6)
  assert.deepEqual(result.ids, ['new', 'old'])
})

test('fills remaining slots from fallback without duplicating recent games', () => {
  const recent: TrendingRankRow[] = [row('a', '2026-06-04T00:00:00Z')]
  const fallback: TrendingRankRow[] = [
    row('a', '2026-05-01T00:00:00Z'),
    row('b', '2026-05-02T00:00:00Z'),
    row('b', '2026-05-03T00:00:00Z'),
    row('c', '2026-05-04T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, fallback, 3)
  assert.deepEqual(result.ids, ['a', 'b', 'c'])
  // fill games are not added to recentCounts
  assert.deepEqual(result.recentCounts, { a: 1 })
})

test('with zero recent reports, result is purely the fallback ordering', () => {
  const fallback: TrendingRankRow[] = [
    row('x', '2026-05-01T00:00:00Z'),
    row('y', '2026-05-02T00:00:00Z'),
    row('y', '2026-05-03T00:00:00Z'),
  ]
  const result = rankTrendingGameIds([], fallback, 6)
  assert.deepEqual(result.ids, ['y', 'x'])
  assert.deepEqual(result.recentCounts, {})
})

test('respects the limit', () => {
  const recent: TrendingRankRow[] = [
    row('a', '2026-06-01T00:00:00Z'),
    row('b', '2026-06-02T00:00:00Z'),
    row('c', '2026-06-03T00:00:00Z'),
  ]
  const result = rankTrendingGameIds(recent, [], 2)
  assert.deepEqual(result.ids, ['c', 'b'])
})

test('empty inputs yield an empty result', () => {
  const result = rankTrendingGameIds([], [], 6)
  assert.deepEqual(result.ids, [])
  assert.deepEqual(result.recentCounts, {})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/trending.test.ts`
Expected: FAIL — cannot find module `./trending` (or `rankTrendingGameIds is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `lib/trending.ts`:

```ts
/**
 * Pure ranking for the home "Trending right now" section.
 *
 * Trending = games with the most NEW reports in a recent window. When fewer than
 * `limit` games have recent reports, remaining slots are filled from a fallback
 * sample (the newest-N reports overall) so the row is never sparse. Kept free of
 * Supabase/React imports so it is unit-testable in isolation.
 */

export interface TrendingRankRow {
  gameId: string
  createdAt: string // ISO
}

interface Tally {
  gameId: string
  count: number
  latest: number // ms epoch of most recent report
}

function tally(rows: TrendingRankRow[]): Map<string, Tally> {
  const byGame = new Map<string, Tally>()
  for (const r of rows) {
    if (!r.gameId) continue
    const ts = new Date(r.createdAt).getTime()
    const t = byGame.get(r.gameId)
    if (t) {
      t.count += 1
      if (ts > t.latest) t.latest = ts
    } else {
      byGame.set(r.gameId, { gameId: r.gameId, count: 1, latest: Number.isNaN(ts) ? 0 : ts })
    }
  }
  return byGame
}

/** Sort by count desc, then most-recent report desc, then gameId for stability. */
function rankTallies(byGame: Map<string, Tally>): string[] {
  return [...byGame.values()]
    .sort((a, b) => b.count - a.count || b.latest - a.latest || a.gameId.localeCompare(b.gameId))
    .map((t) => t.gameId)
}

export function rankTrendingGameIds(
  recentRows: TrendingRankRow[],
  fallbackRows: TrendingRankRow[],
  limit: number,
): { ids: string[]; recentCounts: Record<string, number> } {
  const recentTally = tally(recentRows)
  const ids = rankTallies(recentTally).slice(0, limit)

  const recentCounts: Record<string, number> = {}
  for (const t of recentTally.values()) recentCounts[t.gameId] = t.count

  if (ids.length < limit && fallbackRows.length > 0) {
    const chosen = new Set(ids)
    for (const gameId of rankTallies(tally(fallbackRows))) {
      if (ids.length >= limit) break
      if (chosen.has(gameId)) continue
      chosen.add(gameId)
      ids.push(gameId)
    }
  }

  return { ids, recentCounts }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/trending.test.ts`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/trending.ts lib/trending.test.ts
git commit -m "feat(trending): pure recent-report ranking helper"
```

---

## Task 2: Rewrite `getTrendingGamesAsync` to rank by recent reports

**Files:**
- Modify: `lib/data.ts` (replace the existing `getTrendingGamesAsync`, currently around lines 849-887)

Context: the current `getTrendingGamesAsync` orders games by `updated_at` and returns `Promise<Game[]>`. It has no callers outside `lib/data.ts` (verified), so the return-type change is safe. `withSupabaseReadTimeout`, `isSupabaseConfigured`, `USE_REAL`, `publicStarterGames`, `mapDbGameToGame`, `enrichGamesWithCovers` are all already defined in this file.

- [ ] **Step 1: Add the import for the helper**

At the top of `lib/data.ts`, alongside the other `import` lines (e.g. near the `similarity` import around line 47-48), add:

```ts
import { rankTrendingGameIds, type TrendingRankRow } from './trending'
```

- [ ] **Step 2: Add the result type**

Immediately above the existing `getTrendingGamesAsync` definition, add:

```ts
export interface TrendingResult {
  /** Ordered, length <= limit, covers enriched. */
  games: Game[]
  /** gameId -> number of reports within the window. Fill games are absent (treat as 0). */
  recentCounts: Record<string, number>
}
```

- [ ] **Step 3: Replace the body of `getTrendingGamesAsync`**

Replace the entire existing `getTrendingGamesAsync` function (the doc-comment block plus the function, from `/**\n * Bounded "trending" games...` through its closing brace) with:

```ts
/**
 * "Trending right now" for the home page.
 *
 * Ranks games by how many NEW reports they received in the last `windowDays`
 * days. When fewer than `limit` games have recent reports, the remaining slots
 * are filled with the all-time leaders from the newest-200 report sample (the
 * same sample the home page used before), so the row always renders `limit`
 * cards. Returns the ordered games plus a per-game recent count (the count is
 * currently unused by the UI but returned for a future "+N this week" badge).
 *
 * Uses lightweight two-column queries (game_id + created_at) for ranking, then a
 * single `in(id, ...)` fetch to hydrate the chosen rows — never pulls the whole
 * games table.
 */
export async function getTrendingGamesAsync(limit: number = 6, windowDays: number = 7): Promise<TrendingResult> {
  const safeLimit = Math.min(48, Math.max(1, limit))
  const starterFallback = (): TrendingResult => ({
    games: publicStarterGames().slice(0, safeLimit),
    recentCounts: {},
  })

  if (!USE_REAL || !isSupabaseConfigured()) {
    return starterFallback()
  }

  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

    // 1. Recent ranking rows (cheap: two columns).
    const recentResult = await withSupabaseReadTimeout<any>(
      supabase
        .from('reports')
        .select('game_id, created_at')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(5000),
      'getTrendingGamesAsync.recent',
    )
    if (!recentResult) return starterFallback()
    if (recentResult.error) {
      console.error('[data] getTrendingGamesAsync recent query error:', recentResult.error)
      return starterFallback()
    }
    const recentRows: TrendingRankRow[] = (recentResult.data || []).map((r: any) => ({
      gameId: r.game_id,
      createdAt: r.created_at,
    }))

    // 2. All-time top-up sample, only when recent activity is too thin to fill the row.
    const distinctRecent = new Set(recentRows.map((r) => r.gameId)).size
    let fallbackRows: TrendingRankRow[] = []
    if (distinctRecent < safeLimit) {
      const fallbackResult = await withSupabaseReadTimeout<any>(
        supabase
          .from('reports')
          .select('game_id, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
        'getTrendingGamesAsync.fallback',
      )
      if (fallbackResult && !fallbackResult.error) {
        fallbackRows = (fallbackResult.data || []).map((r: any) => ({
          gameId: r.game_id,
          createdAt: r.created_at,
        }))
      }
    }

    const { ids, recentCounts } = rankTrendingGameIds(recentRows, fallbackRows, safeLimit)
    if (ids.length === 0) return starterFallback()

    // 3. Hydrate the chosen game rows in one query, then restore ranked order.
    const gamesResult = await withSupabaseReadTimeout<any>(
      supabase.from('games').select('*').in('id', ids),
      'getTrendingGamesAsync.games',
    )
    if (!gamesResult || gamesResult.error) {
      if (gamesResult?.error) console.error('[data] getTrendingGamesAsync games query error:', gamesResult.error)
      return starterFallback()
    }
    const mapped = (gamesResult.data || []).map(mapDbGameToGame)
    if (mapped.length === 0) return starterFallback()

    const enriched = await enrichGamesWithCovers(mapped)
    const byId = new Map<string, Game>(enriched.map((g) => [g.id, g]))
    const ordered = ids.map((id) => byId.get(id)).filter((g): g is Game => Boolean(g))

    return { games: ordered, recentCounts }
  } catch (err: any) {
    console.error('[data] getTrendingGamesAsync unexpected error:', err)
    return starterFallback()
  }
}
```

- [ ] **Step 4: Verify types + lint (no dev-server build — see memory)**

Run: `npx tsc --noEmit`
Expected: PASS (no errors referencing `lib/data.ts` or `lib/trending.ts`).

Run: `npm run lint`
Expected: no new errors in `lib/data.ts`.

> Do NOT run `next build` — per project memory, building against a live dev server serves stale pages. `tsc --noEmit` + lint is the verification path.

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts
git commit -m "feat(trending): rank home trending by recent report activity"
```

---

## Task 3: Wire the home page to the new adapter

**Files:**
- Modify: `app/page.tsx`

Context: the page currently runs `['all-games']` (`getAllGames`) and `['all-reports']` (`getAllReportsAsync`) queries, derives `trending` and `gameStatsMap` via `useMemo`, and computes hero counts from `allReports.length`. Replace that data layer; keep all JSX/markup (hero art, card grid, skeletons, notices, empty states, `ValueLoopExplainer`) intact.

- [ ] **Step 1: Replace the imports and the data/derivation block**

In `app/page.tsx`, change the data import line (currently `import { getAllGames, getAllReportsAsync, computeGameStatsFromReports } from '@/lib/data'`) to:

```ts
import { getTrendingGamesAsync, getReportsForGamesAsync, getGlobalCountsAsync, computeGameStatsFromReports } from '@/lib/data';
```

Then replace everything from the start of the component body (the `gamesQuery` declaration) down to and including the `gameStatsMap` `useMemo` and the `totalReports` / `totalGames` / `avgReportsPerGame` lines with:

```ts
  // Trending = games with the most new reports in the last 7 days (adapter handles
  // ranking + all-time top-up + fallbacks). Replaces the old all-games/all-reports derive.
  const trendingQuery = useQuery({
    queryKey: ['trending-games'],
    queryFn: () => getTrendingGamesAsync(6, 7),
  });

  const trending = trendingQuery.data?.games ?? [];
  const trendingIds = trending.map((g) => g.id);

  // Per-card stats for ONLY the visible trending games (batched single query).
  const statsQuery = useQuery({
    queryKey: ['trending-game-stats', trendingIds],
    queryFn: () => getReportsForGamesAsync(trendingIds),
    enabled: trendingIds.length > 0,
  });

  const gameStatsMap = useMemo(() => {
    const map: Record<string, GameStats> = {};
    const byGame = statsQuery.data;
    if (!byGame) return map;
    trending.forEach((g) => {
      const greports = byGame.get(g.id) ?? [];
      if (greports.length > 0) map[g.id] = computeGameStatsFromReports(greports);
    });
    return map;
  }, [statsQuery.data, trending]);

  // Lightweight global counts (head:true count queries — no row payloads).
  const countsQuery = useQuery({
    queryKey: ['global-counts'],
    queryFn: () => getGlobalCountsAsync(),
  });

  const totalReports = countsQuery.data?.totalReports ?? 0;
  const totalGames = countsQuery.data?.totalGames ?? 0;
  const avgReportsPerGame = totalGames > 0 ? Math.round(totalReports / totalGames) : 0;
```

Note: `getReportsForGamesAsync` returns a `Map<string, Report[]>` (confirmed in `lib/data.ts`), hence the `.get(g.id)` access above.

- [ ] **Step 2: Repoint the loading-notice effect**

Replace the `showLoadingNotice` `useMemo` block (the one referencing `gamesQuery.isLoading || reportsQuery.isLoading`) with:

```ts
  const [showLoadingNotice, setShowLoadingNotice] = useState(false);
  useMemo(() => {
    const t = setTimeout(() => {
      if (trendingQuery.isLoading && trending.length === 0) {
        setShowLoadingNotice(true);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, [trendingQuery.isLoading, trending.length]);
```

- [ ] **Step 3: Repoint the JSX loading / refreshing / error conditions**

In the trending grid JSX, update the conditions that referenced the removed queries:

- Skeleton gate — change `(gamesQuery.isLoading || reportsQuery.isLoading) && trending.length === 0` to:
  ```tsx
  trendingQuery.isLoading && trending.length === 0
  ```
- Privacy/adblock notice gate — change `(showLoadingNotice || (gamesQuery.isLoading || reportsQuery.isLoading)) && trending.length === 0` to:
  ```tsx
  (showLoadingNotice || trendingQuery.isLoading) && trending.length === 0
  ```
- "Refreshing trending…" gate — change `(gamesQuery.isLoading || reportsQuery.isLoading) && trending.length > 0` to:
  ```tsx
  trendingQuery.isFetching && trending.length > 0
  ```
- Error notice gate — change `(gamesQuery.isError || reportsQuery.isError)` to:
  ```tsx
  trendingQuery.isError
  ```

Leave the `games.length === 0` empty-state branch as-is — but note `games` no longer exists as a variable. Change that branch's condition from `games.length === 0` to `trending.length === 0 && !trendingQuery.isLoading` is NOT needed; instead replace the `games.length === 0 ? (...)` ternary condition with `trendingIds.length === 0 ? (...)`. (The "No games in the database yet" copy stays; it now shows when the adapter returned nothing.)

- [ ] **Step 4: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: PASS — no references to the removed `gamesQuery` / `reportsQuery` / `allReports` / `games` remain.

Run: `npm run lint`
Expected: no new errors in `app/page.tsx`.

> Do NOT run `next build` (project memory: stale pages against live dev server).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(trending): home page renders recent-activity trending"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS, including the new `lib/trending.test.ts` cases.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (optional, if a dev server is already running)**

Load the home page. Confirm:
- "Trending right now" shows up to 6 cards.
- With sparse/uniform-timestamp data, it still shows 6 (fallback path).
- Hero stats (reports / games / reports per game) populate from `getGlobalCountsAsync`.

---

## Self-review notes

- **Spec coverage:** recent-window ranking (Task 1 helper + Task 2 query), 7-day window (Task 2 default), all-time top-up (Task 1 fallback + Task 2 fallback query), dedicated adapter not inline/RPC (Task 2), thin page (Task 3), card stats via `getReportsForGamesAsync` (Task 3), hero counts via `getGlobalCountsAsync` (Task 3), `recentCounts` returned but unrendered (Task 2 type + Task 3 ignores it), safety/fallback paths (Task 2 `starterFallback`), pure-helper unit tests (Task 1). All covered.
- **Type consistency:** `TrendingRankRow` and `rankTrendingGameIds` signatures match between `lib/trending.ts`, its test, and `lib/data.ts`. `getReportsForGamesAsync` returns `Map<string, Report[]>` — the page uses `.get(id)`. `getGlobalCountsAsync` returns `{ totalGames, totalReports }` — matched. `getTrendingGamesAsync` returns `TrendingResult` consumed as `.data?.games`.
- **No placeholders:** all steps contain concrete code/commands.
