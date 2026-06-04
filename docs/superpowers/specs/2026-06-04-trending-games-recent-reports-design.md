# Trending Games = Recent Report Activity — Design

Date: 2026-06-04
Status: Approved (pending spec review)
Branch: feature/compatibility-match-feed

## Problem

The home page "Trending right now" section does not show trending games. It
fetches the newest 200 reports (`getAllReportsAsync`) plus the full games list
(`getAllGames`), then sorts *all* games by their **all-time report count** and
slices the top 6. That is "most-reported," not "trending" — a title that was
popular long ago outranks one getting a burst of new reports today.

A separate `getTrendingGamesAsync()` already exists in `lib/data.ts` but is
unused and sorts games by `updated_at` (most recently touched row), which is
also not report-activity trending.

## Goal

Make "Trending right now" rank games by **how many new reports they received in
the last 7 days**, with an all-time top-up so the row is never sparse.

Decisions (confirmed with user):
- Trending signal: count of NEW reports in a recent window.
- Window: 7 days.
- Fallback when fewer than `limit` games have recent reports: fill remaining
  slots with top all-time games (preserves today's behavior for the tail).
- Approach: dedicated data adapter (Approach B), not inline page logic and not a
  Supabase RPC/view.

## Approach (B): dedicated data adapter

Keep `app/page.tsx` thin; put ranking in `lib/data.ts` where it is testable and
reusable. Internals can later be swapped for an RPC without touching the page.

### New/replaced adapter

Replace the body of the existing unused `getTrendingGamesAsync` in
`lib/data.ts`:

```ts
getTrendingGamesAsync(limit = 6, windowDays = 7): Promise<TrendingResult>
```

where

```ts
interface TrendingResult {
  games: Game[];                       // ordered, length <= limit, covers enriched
  recentCounts: Record<string, number>; // gameId -> reports in window (0 for fill games)
}
```

`recentCounts` is returned for an optional future "+N this week" badge; it is NOT
rendered in this change.

### Ranking algorithm

1. **Recent ranking query.** From `reports`, select `game_id` only, filtered
   `created_at >= now - windowDays`, ordered `created_at desc`, capped at 5000
   rows (two columns — cheap payload). Count per `game_id`, sort count desc
   (tie-break: most recent report first). → primary ordered game IDs +
   `recentCounts`.
2. **All-time top-up.** If fewer than `limit` distinct games qualify, fetch the
   newest 200 report `game_id`s (today's `getAllReportsAsync` sample size),
   count per game, and append the highest-count games not already chosen until
   `limit` is reached. Fill games get `recentCounts` of 0.
3. **Hydrate.** Fetch the chosen (<= limit) game rows from `games` via
   `in('id', ids)`, map with `mapDbGameToGame`, run `enrichGamesWithCovers`,
   then re-order to match the ranked ID order.
4. Return `{ games, recentCounts }`.

### Fallback / safety paths (match existing adapter conventions)

- Non-real mode or Supabase not configured →
  `{ games: publicStarterGames().slice(0, limit), recentCounts: {} }`.
- Any query error or empty result → starter catalog slice (logged via
  `console.error`, never throws). Same defensive shape as the other `*Async`
  adapters.
- Use `withSupabaseReadTimeout` for the recent ranking query so a slow/blocked
  Supabase still degrades to the starter catalog.

## Home page changes (`app/page.tsx`)

- Replace the `['all-games']` and `['all-reports']` React Query calls and the
  `trending` / `gameStatsMap` `useMemo`s with:
  - `['trending-games']` → `getTrendingGamesAsync(6, 7)` for the ordered cards.
  - `['trending-game-stats', ids]` → `getReportsForGamesAsync(ids)` then
    `computeGameStatsFromReports` per game, to populate card stats (avg FPS,
    badges, report counts) for only the <= 6 visible games. Enabled once the
    trending query resolves with ids.
  - `['global-counts']` → `getGlobalCountsAsync()` for the hero stats
    (`totalReports`, `totalGames`, `avgReportsPerGame`) instead of
    `allReports.length` (which was capped at 200 and undercounted anyway).
- `trending` becomes `trendingQuery.data?.games ?? []`.
- Loading skeletons: gated on `trendingQuery.isLoading` (instead of the two
  removed queries). Keep the 6-skeleton grid, the privacy/adblock notice, the
  "refreshing" line, and the error notice — repoint their conditions to the new
  queries.
- Empty states unchanged: `games.length === 0` → "No games in the database yet";
  otherwise the "community reports will rank titles here" message.

No visual/markup changes to cards or layout — only the data source for ordering
and stats.

## Out of scope (YAGNI)

- Rendering a "+N this week" badge (data is returned but unused).
- A Supabase RPC / materialized view for aggregation (Approach C).
- Changing the report fetch hard caps elsewhere.
- Any change to `/games` browse ordering.

## Testing

- Unit-test the ranking selection as a pure helper. Extract the
  count-and-rank-with-fallback step into a pure function
  (e.g. `rankTrendingGameIds(recentRows, fallbackRows, limit)`) so it can be
  tested without Supabase:
  - games ordered by recent count desc;
  - tie-break by most-recent report;
  - fewer than `limit` recent games → filled from fallback, no duplicates;
  - zero recent reports → result is purely the fallback ordering;
  - empty inputs → empty result.
- Manual: home page shows 6 cards ordered by recent activity; sparse-data case
  still shows 6 via fallback; non-real mode shows starter catalog.

## Risk notes

- Seeded ProtonDB data may share an ingest timestamp; a 7-day window could be
  empty. The all-time top-up makes this safe — the row still renders 6 cards.
- The "all-time" fill is the newest-200 sample (not a true full aggregation),
  identical to today's behavior, so no regression; a real all-time count can
  replace it later via RPC if needed.
