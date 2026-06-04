# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project should use semantic versioning once public releases begin.

## [Unreleased]

### Added

- Professional repository documentation in `README.md`, including product overview, setup, architecture, environment variables, deployment prep, scripts, security notes, and contribution guidance.
- Root changelog to track future product, infrastructure, schema, and documentation changes.

### Changed

- Reframed the project description around RunDB's core value: real PC hardware, measured FPS reports, compatibility predictions, and community moderation.

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
- Some admin moderation and bulk-management paths are still part of the ongoing real-data migration; see `context/admin-and-moderation.md` for details.
