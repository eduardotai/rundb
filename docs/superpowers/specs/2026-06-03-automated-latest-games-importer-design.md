# Automated Latest-Releases Game Importer — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Author:** RunDB

## Problem

The game catalog misses recent releases (e.g. Resident Evil Requiem, Forza Horizon 6).
The app runs in real-data mode (`NEXT_PUBLIC_USE_REAL_DATA=true`), so it reads from
Supabase — hand-editing `lib/mock-data.ts` does not surface new games in the running app.

Adding games by hand does not scale. We need an automated way to keep the Supabase
`games` catalog current with the latest releases.

## Goals

- Automatically discover recent game releases and ingest them into Supabase.
- Correct cover art and metadata (genres, year, developer, publisher).
- No new credentials beyond what is already configured.
- Idempotent and safe to re-run (and later, to schedule).

## Non-Goals

- Keeping the `lib/mock-data.ts` demo catalog in sync (app is real-mode).
- Building a scheduler/cron (documented as a follow-up, not built here).
- A general admin UI for imports (CLI script only).

## Key Decisions

- **Discovery source:** Steam public charts (`featuredcategories`: `new_releases` +
  `top_sellers`, optionally `coming_soon`). No API key. Yields Steam AppIDs, which make
  the downstream IGDB match validation reliable.
- **Automation level:** Fully automatic — discover and write to Supabase in a single run.
- **Reuse:** All enrichment/validation/media upload reuses the existing, proven
  `ingestGame()` in `lib/server/ingest-game.ts`. Discovery is the only new logic.

## Architecture

```
featuredcategories  ->  candidate appids  ->  appdetails (filter: type=game + recent)
        (Steam)                                          |
                                                         v
                                                   SeedGame[]
                                                         |
                                  dedup vs Supabase games (slug, steam_app_id)
                                                         |
                                                         v
                              ingestGame() per seed  (IGDB enrich + cover/screenshot
                                                      upload + upsert)  ->  Supabase
```

## Components

### 1. `lib/server/discover-steam-games.ts` (new)

The only genuinely new logic. Resilient: never throws to callers; logs and continues.

Public surface:

```ts
export interface DiscoverOptions {
  sinceYear?: number          // default: currentYear - 1
  includeUnreleased?: boolean // include coming_soon (no firm release date)
  limit?: number              // cap candidates after filtering
}

export interface SeedGame {
  name: string
  slug: string                // normalizeSlug(name)
  steamAppId: string
}

export async function discoverLatestSteamGames(
  opts?: DiscoverOptions
): Promise<SeedGame[]>
```

Behavior:
1. `GET https://store.steampowered.com/api/featuredcategories?cc=us&l=en`.
   Collect appids from `new_releases.items[]`, `top_sellers.items[]`, and
   (if `includeUnreleased`) `coming_soon.items[]`. Dedup appids.
2. For each appid: `GET https://store.steampowered.com/api/appdetails?appids=<id>&cc=us&l=en`.
   Rate-limited (~200 ms between calls), timeout + retry, resilient (skip on failure).
3. Keep entries where `data.type === 'game'`, non-adult, has a `name`.
   Parse release year from `data.release_date.date`; entries with `coming_soon` true are
   only kept when `includeUnreleased`.
4. Filter: `releaseYear >= sinceYear` (unreleased entries pass when `includeUnreleased`).
5. Map to `SeedGame { name, slug: normalizeSlug(name), steamAppId: String(appid) }`.
   Apply `limit` if set. Return.

Shared HTTP helpers (timeout + retry) follow the pattern already used in
`lib/game-id-resolver.ts` (`fetchWithTimeout`, `resilientFetch`).

### 2. Dedup against Supabase

In the orchestrator: `select slug, steam_app_id from games`. Build a `Set` of existing
slugs and a `Set` of existing steam_app_ids. Drop any candidate already present by either
key. `ingestGame`'s upsert-on-`slug` makes re-runs idempotent even if dedup misses.

### 3. `scripts/import-latest-games.ts` (new orchestrator)

- `loadEnvLocal()`; create Supabase service client; validate
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `IGDB_CLIENT_ID` +
  `IGDB_CLIENT_SECRET` (same checks as `scripts/ingest-games.ts`).
- Parse flags: `--dry-run` (discover + print only, no writes), `--limit=N`,
  `--since-year=YYYY`, `--months=N` (converted to a sinceYear cutoff),
  `--include-unreleased`.
- `discoverLatestSteamGames(opts)` -> dedup vs Supabase -> for each new seed:
  `ingestGame(client, seed, { dryRun, onLog })`.
- Print a summary: candidates found / already in catalog / new / ingested / failed,
  with the first few failures. Match the logging style of the existing ingest scripts.
- Add `"import:latest": "tsx scripts/import-latest-games.ts"` to `package.json` scripts.

### 4. Scheduling (follow-up, not built)

Because the run is fully automatic and idempotent, `npm run import:latest` can be placed
on Windows Task Scheduler / cron, or wired to `/schedule`. Documented only.

## Data Model

No schema changes. Writes go through the existing `games` + `game_media` tables via
`ingestGame()`.

## Error Handling

- Steam network calls: timeout + bounded retry; per-appid failures are skipped (logged),
  never abort discovery.
- Per-game ingest failures are isolated, collected, and summarized; the batch continues.
- Total Steam-endpoint failure (no candidates at all) -> exit non-zero with a clear message.
- Missing credentials -> exit non-zero with a clear message (before any network calls).

## Testing

- **Unit:** pure transform/filter logic (a captured `appdetails` JSON fixture ->
  `SeedGame`; verify type filter drops non-`game`, recency filter drops old titles,
  `includeUnreleased` gating, slug normalization). No network. Mirrors
  `tests/igdb-game-match.test.ts`.
- **Manual integration:** `npm run import:latest -- --dry-run` to preview discovered new
  games; then a real run on a small `--limit`.

## Rollout

1. Implement discovery module + orchestrator + unit test + npm script.
2. First real run: also push the 10 already-curated 2025–2026 titles (known Steam
   AppIDs, currently only in `mock-data.ts`) through the existing
   `scripts/ingest-games.ts` with a seed JSON, so they appear in the real app.
3. Verify in the app that new games render with correct covers and metadata.

## Why This Design

- Maximizes reuse: only discovery is new; enrichment/validation/media are the proven path.
- No new credentials (Steam endpoints are public).
- Idempotent and safe to schedule.
