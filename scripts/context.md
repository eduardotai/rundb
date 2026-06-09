# scripts Context

## Purpose
`scripts/` owns local and operational CLI tools for ingestion, seeding, verification, cover repair, Supabase setup, and maintenance.

## Read This First
- `load-env-local.ts`: shared helper for loading `.env.local` into script processes. Never copy actual secret values into docs or commits.
- `ingest-games.ts`: primary direct catalog enrichment script.
- `ingest-games-worker.ts`: queue worker for background or batch enrichment.
- `seed-queue.ts`, `build-protondb-seed.ts`, `inspect-protondb-dump.ts`, `import-latest-games.ts`: catalog growth and seed preparation.
- `seed-games-mock.ts`, `seed-hardware-catalog.ts`, `import-hardware-catalog.ts`, `verify-hardware-catalog.ts`: starter data and hardware catalog tooling.
- `reingest-covers-all.ts`, `repair-game-media-covers.ts`, `fix-game-covers.ts`: cover/media maintenance.
- `setup-supabase-real.ts`, `supabase-health.ts`, `phase5-e2e-real-data.ts`: project setup and real-data verification.
- `publish-feature-branch.ps1`: Windows/PowerShell helper for publishing work.

## Main Responsibilities
- Grow the game catalog from seeds, ProtonDB-style data, latest-game candidates, Steam, IGDB, and PCGamingWiki-style metadata.
- Populate and process `game_ingest_queue` so skeleton games can be enriched in batches.
- Seed or verify hardware catalog data.
- Maintain cover quality, media rows, attribution, and storage URLs.
- Run real-data readiness checks against Supabase-backed deployments.
- Provide operational commands that complement the admin UI.

## Data Flow
- Scripts load environment from `.env.local` through `load-env-local.ts` when needed.
- Real data scripts use service-role Supabase via `lib/supabase/service.ts` or server helpers in `lib/server/*`.
- Queue scripts read from `seeds/*.json`, insert or update Supabase rows, and then workers enrich games and media.
- Cover repair scripts inspect existing game/media rows, resolve better image candidates, upload or update metadata, and keep `public-game-covers.json` useful for zero-config fallback.
- Hardware scripts consume `seeds/hardware-catalog-dataset.json` and write or validate `hardware_catalog` data.

## AI Rules
- Never commit secrets from `.env.local`, Supabase service-role keys, IGDB credentials, Steam keys, or generated logs containing them.
- Treat scripts as potentially side-effectful. Prefer dry-run flags if the script supports them, and read the header/options before running.
- Service-role operations belong in scripts and server-only helpers, not browser/client code.
- Keep script insert/update shapes aligned with `supabase/schema.sql`, `lib/types.ts`, and `lib/data.ts` mappers.
- Preserve idempotency where possible: queue and seed scripts should tolerate reruns without duplicating canonical rows.
- Be careful with rate-limited external APIs; keep batching and retry behavior bounded.

## Common Changes
- Adding a seed source: add or update a `seeds/*.json` file, create a parser/mapper script, document env requirements, and add validation output.
- Adding an ingest field: update script payloads, `lib/server/ingest-game.ts`, Supabase schema, types, data mappers, and UI consumers.
- Fixing cover quality: update cover resolver/server media helpers, then run a focused repair/reingest script.
- Changing hardware catalog shape: update hardware seed/import/verify scripts plus `lib/hardware-catalog*` and Supabase schema.
- Adding a production check: add a script with clear expected output and avoid requiring browser/client state.

## Verification
- For docs-only script context edits: run `npm run test` and `npm run lint` as repository checks.
- For script logic changes: run the focused script with dry-run or a small sample first.
- For hardware scripts: run `npm run verify:hardware`.
- For ingest queue changes: run a small queue batch before a large one.
- For Supabase connectivity: run `npx tsx scripts/supabase-health.ts` when real credentials are configured.

## Related Context
- `../lib/context.md`
- `../supabase/context.md`
- `../seeds/context.md`
- `../public/context.md`
- `../tests/context.md`
