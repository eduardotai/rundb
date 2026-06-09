# supabase Context

## Purpose
`supabase/` owns the database schema, incremental SQL migrations, RLS policies, RPCs, privileged database behavior, and auth email templates for RunDB real-data mode.

## Read This First
- `schema.sql`: source of truth for tables, enums, indexes, RLS, triggers, functions, RPCs, and phase-added columns.
- `incremental-*.sql`: additive SQL changes for security, username uniqueness, game media, ingest queue, hardware catalog, reputation/voting, and RLS performance.
- `secure-profile-role.sql`: role-hardening helper for profile security.
- `email-templates/README.md`, `confirm-signup.html`, `reset-password.html`: Supabase Auth email templates.

## Main Responsibilities
- Define real data shapes for games, reports, profiles, user rigs/devices, votes, media, hardware catalog, aliases, queue rows, and moderation state.
- Enforce public/owner/moderator/admin access through RLS.
- Provide SECURITY DEFINER RPCs for operations that should bypass fragile client-side RLS paths while still validating inputs.
- Keep report submission authoritative: tier calculation, rate limiting, duplicate checks, status defaults, and insert behavior belong in database logic as well as friendly app preflight.
- Support game ingestion, media enrichment, hardware catalog curation, and queue processing.
- Provide auth email templates that match the app's `/auth/*` pages and callback flow.

## Data Flow
- `app/actions/reports.ts` calls report RPCs and may use service-role fetches to return pending rows.
- `lib/data.ts` maps Supabase rows into `lib/types.ts` domain shapes for app/components.
- `lib/server/*` and `scripts/*` use service-role access for ingest, queue processing, setup, and maintenance.
- Public reads are generally allowed for games, approved reports, game media, and hardware catalog data.
- Owner data such as profiles, user rigs, report ownership, and votes is protected by `auth.uid()`.
- Moderator/admin behavior is controlled through `profiles.role` and matching RLS/action checks.

## AI Rules
- Schema changes must be mirrored in `lib/types.ts`, `lib/data.ts` mappers, server actions/RPC payloads, scripts, UI forms, and tests.
- Never weaken RLS just to make client code work; prefer a validated RPC or server action.
- Keep service-role assumptions out of client-accessible code.
- Preserve public-approved report reads: pending/rejected/flagged content should not leak through normal public queries.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and never documented with real values.
- Add indexes or bounded query patterns when introducing queries over reports, media, queue, or catalog tables.
- Treat incremental SQL as deployable migration history; do not silently contradict `schema.sql`.

## Common Changes
- Adding a report column: update table definition, RPC signature/defaults, insert logic, mapper, type, form, ReportCard display if visible, and tests.
- Adding moderation behavior: update report status fields or policy logic, admin actions/UI, and any queue or notification scripts.
- Adding ingest metadata: update `games`, `game_media`, or queue SQL plus scripts and server ingest helpers.
- Changing profile or user rig behavior: update auth trigger/profile policies, `user_rigs`, profile page components, saved-rig adapter logic, and auth tests if relevant.
- Adding hardware catalog fields: update SQL, import/seed/verify scripts, catalog mapper, combobox display, and normalization logic.
- Updating email templates: keep links compatible with `/auth/callback`, `/auth/confirmed`, reset, and error pages.

## Verification
- Run `npm run test` for mapper and pure logic coverage after schema-driven changes.
- Run `npm run lint` for TypeScript consumers.
- Run `npm run build` when database types or actions change.
- In a real Supabase project, apply SQL in a safe environment first and run `npx tsx scripts/supabase-health.ts`.
- For hardware catalog SQL changes, run `npm run verify:hardware`.

## Related Context
- `../lib/context.md`
- `../app/context.md`
- `../scripts/context.md`
- `../tests/context.md`
