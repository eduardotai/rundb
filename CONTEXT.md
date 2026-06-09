# RunDB Project Context

**Start here, then read the `context.md` file inside the folder you will edit.** These files are written for AI agents and humans who need enough project context to work without opening every source file line by line.

## One-Paragraph Summary
RunDB is a community-driven database of real PC hardware configurations, measured in-game FPS, settings, tweaks, and compatibility confidence. It is a Next.js 16 App Router, React 19, TypeScript, Tailwind/shadcn, and Supabase app migrating from a polished mock/localStorage demo to a production real-data platform. The migration is controlled by `NEXT_PUBLIC_USE_REAL_DATA` and defensive Supabase clients so missing keys or unreachable services fall back to the zero-config demo path. The heart of the UI is the dense, scannable `ReportCard`; the heart of the architecture is `lib/data.ts`; the heart of data quality is the hardware catalog, normalization, and explicit detection flow.

## Start Here
1. Read this root `CONTEXT.md` for global product and architecture rules.
2. Read the folder-level `context.md` for the area you will touch:
   - `app/context.md` for App Router pages, layouts, route handlers, server actions, auth, and global styles.
   - `components/context.md` for product UI, ReportCard, forms, hardware controls, charts, dashboard/profile/report components, and shadcn/Radix primitives.
   - `lib/context.md` for the data adapter, types, pure logic, Supabase wrappers, hardware, covers, media, and server helpers.
   - `scripts/context.md` for ingestion, seeding, repair, verification, env loading, and service-role operations.
   - `supabase/context.md` for schema, RLS, RPCs, incremental SQL, auth/profile/report tables, queue, catalog, and email templates.
   - `tests/context.md` for Node test runner patterns and focused coverage.
   - `seeds/context.md` for committed seed datasets and import expectations.
   - `public/context.md` for static public assets and cover catalog behavior.
3. Cross-reference source only for exact implementation details after reading the relevant context file.

## Quick Mental Model
- UI is thin: pages coordinate React Query data and compose domain components.
- Data is dual-mode: real Supabase when enabled and configured, mock/local fallback otherwise.
- `lib/data.ts` is the main app/component data boundary.
- Pure logic is shared: real paths fetch rows, map snake_case to domain types, then call the same helpers used by mock paths.
- Writes are protected: report submission goes through Server Action -> validated preflight -> `submit_report` SECURITY DEFINER RPC.
- Hardware is structured: free text normalizes against catalog data; detection is explicit and user-reviewed before apply.
- Covers are resilient: static catalog, DB fields, resolvers, and batched `game_media` queries layer together.
- Scale safety matters: keep hard caps, bounded trending, head-only counts, and batched media/report queries.
- Admin and moderation are privileged growth tools, backed by role checks and RLS.

## Current State
- Real reports, upvoting, user rigs, and profile mirrors are live when real-data mode is enabled.
- Hardware catalog, comboboxes, browser/paste detection, and normalization are live.
- Games and game media can come from ingestion; cover enrichment is layered and defensive.
- React Query and batched adapters are in place for home, games, and detail surfaces.
- Some admin moderation, aliases, image moderation, and bulk-management helpers still delegate to mock behavior (now isolated in `lib/admin-demo.ts`, bundled only with `/admin`); queue triggers and hardware-catalog admin paths are more real.
- Defensive Supabase wrappers prevent missing or dead projects from hanging local development.

## Golden Rules
- Follow `AGENTS.md`. For Next.js-specific changes, read the relevant docs under `node_modules/next/dist/docs/` first because this repo uses Next.js 16 with breaking changes.
- Never import mock data or raw Supabase directly from `app/` or `components/` except through established adapter/server-only patterns.
- Prefer async helpers and `use*` React Query hooks for new user-facing data.
- Keep service-role access in server-only files, route handlers, server actions, or scripts.
- Update schema, types, mappers, RPCs, actions, forms, display components, scripts, tests, and context docs together when adding persisted fields.
- Detection is always detect -> review -> apply; never silently save detected hardware.
- Keep the zero-config demo path working when Supabase keys are absent.
- Do not copy secrets from `.env.local` into code, docs, logs, tests, or seed files.

## Verification Defaults
- Run `npm run test` for pure logic, mappers, ingestion helpers, hardware, cover, chart, and auth behavior.
- Run `npm run lint` after TypeScript/TSX edits.
- Run `npm run build` after Next.js route/layout/server-action, broad type, or server/client boundary changes.
- For documentation-only context updates, `npm run test` and `npm run lint` are enough unless tooling reports otherwise.

## Historical Memory
The old archive-style `context/` folder has been replaced by colocated folder-level `context.md` files. Longer design history still lives in `plans/` and `docs/`, including hardware identification, validation, Phase 7 similarity, visual polish, and historical verification reports.
