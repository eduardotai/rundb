# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project should use semantic versioning once public releases begin.

## [Unreleased]

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
