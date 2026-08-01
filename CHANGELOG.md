# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project should use semantic versioning once public releases begin.

## [Unreleased]

### Added

- **Lazy Steam official requirements on game detail** — opening a game with a `steam_app_id` but empty min/rec triggers a one-shot server ensure (no full-catalog backfill). Results persist to Supabase; negative cache columns `official_reqs_checked_at` / `official_reqs_status` avoid re-hitting Steam on empty/429. Non-blocking UI (“Fetching official requirements from Steam…”). Migration: `supabase/incremental-game-official-reqs-cache.sql`.
- Server Action `ensureGameOfficialRequirementsAction` + `lib/server/ensure-steam-requirements.ts` (decision matrix, merge, claim, unit tests).
- **Official Spec Quick Check** — when a game has publisher min/recommended requirements, compare the user’s saved rig (CPU/GPU/RAM via catalog `perfIndex`) and show a clear verdict with component breakdown. Primary on game pages with **zero community reports**; compact secondary line when reports already exist.
- Pure modules: `lib/parse-system-requirements.ts` (dual-vendor strings + Steam HTML fixtures), `lib/official-spec-check.ts` (OR-of-alternatives comparison), `components/official-spec-check.tsx` UI.
- Unit tests for parser and verdict engine (`lib/*.test.ts`).

### Changed

- Empty community prediction no longer paints a fake “Playable” tier on the game page tier bar when there are no matching reports (`confidence` 0 + no marker).
- `ingestGame()` official-reqs write shared with lazy ensure (stamps cache status when columns exist).

### Added (PR3 — Steam requirements ingest)

- `lib/server/steam-requirements.ts` + `extractOfficialReqsFromPcRequirements` / `officialReqsDbPatch` — Steam `appdetails` → structured min/rec.
- `ingestGame()` now writes `official_min_reqs` / `official_rec_reqs` when Steam returns parseable PC requirements (never clears existing values with nulls).
- `npm run backfill:steam-reqs` (`scripts/backfill-steam-requirements.ts`) — rate-limited backfill for existing `steam_app_id` rows (`--dry-run`, `--limit=N`, `--force`, `--delay-ms`, stop-after consecutive 429s).

## [1.0.0] - 2026-07-08

First public release of RunDB — community-driven PC performance data for games.

### Added

- `SiteFooter` component with compact icon-only links (Dashboard, GitHub, X) and Discord placeholder (coming soon).
- Animated repository banner (`.github/assets/banner.svg`) styled as an in-game FPS benchmark overlay.
- Professional repository documentation in `README.md`, including product overview, setup, architecture, environment variables, deployment prep, scripts, security notes, and contribution guidance.
- Root changelog to track product, infrastructure, schema, and documentation changes.
- Dedicated pure tests for `applyGamesBrowseTransform` (Browse Games tier filter and sort).

### Changed

- Home page hero and empty states emphasize "Submit your first report" alongside Browse Games and Check My PC.
- Reframed the project description around RunDB's core value: real PC hardware, measured FPS reports, compatibility predictions, and community moderation.
- Revamped `README.md` with a visual GitHub-first layout: status badges, Mermaid diagrams for the product loop and data-adapter architecture, alert callouts for critical rules (Next.js 16 docs, service-role key safety, adapter boundary), and collapsible sections for repository structure, data model, and script catalogs.
- Footer: smaller footprint, icon-driven social links; X account corrected to [@taisalless](https://x.com/taisalless).

### Fixed

- Implemented missing `applyGamesBrowseTransform` (pure helper in data-logic) + wired exports/imports so Browse Games tier filter ("Dominant community tier") and "Most reports" sort work correctly in real-data paginated mode.
- Fixed `getAllGames` import and cleaned implicit `any`s in games browse page.
- Data adapter real-data paths now guard with `isSupabaseConfigured()` before hitting Supabase; `useGame` returns `null` instead of `undefined` for missing games.

## [0.1.0] - 2026-06-04

### Added

- Next.js 16 App Router application for browsing games, reports, compatibility information, profiles, and saved rigs.
- Supabase-backed production schema for games, reports, profiles, user rigs, hardware catalog data, report votes, game media, moderation state, and ingest queues.
- Dual-mode data architecture that supports Supabase real data and local mock/demo behavior.
- Hardware-aware report cards, compatibility checking, rig persistence, normalization helpers, and hardware detection flows.
- Game ingestion tooling for starter seeds, ProtonDB-style queue building, IGDB/Steam/PCGamingWiki enrichment, covers, and media maintenance.
- Admin-oriented surfaces for moderation, bulk import, hardware catalog work, and ingest queue operations.
- GitHub Actions CI workflow for dependency installation, linting, and production builds.

### Notes

- This baseline documents the repository's current active-development state rather than a tagged public release.
- Some admin moderation and bulk-management paths are still part of the ongoing real-data migration; see `app/context.md`, `lib/context.md`, and `supabase/context.md` for current details.
