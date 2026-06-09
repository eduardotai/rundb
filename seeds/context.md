# seeds Context

## Purpose
`seeds/` stores JSON datasets used by ingestion, queue seeding, hardware catalog import, and test/sample workflows.

## Read This First
- `hardware-catalog-dataset.json`: canonical hardware seed data consumed by catalog import/verification scripts.
- `latest-2025-2026.json`: latest game candidates used by import tooling.
- `protondb-top-10k.json`: large ProtonDB-style seed source for catalog growth and queue priority hints.
- `test-sample.json`: small sample data for focused script or helper tests.

## Main Responsibilities
- Provide committed, reproducible input data for catalog growth.
- Preserve report-count/popularity hints for queue priority.
- Feed hardware catalog import and validation workflows.
- Give scripts small and large datasets without requiring an external download every run.

## Data Flow
- `scripts/build-protondb-seed.ts` and `scripts/inspect-protondb-dump.ts` prepare or inspect ProtonDB-style data.
- `scripts/seed-queue.ts` reads seed rows and populates `game_ingest_queue`.
- `scripts/import-latest-games.ts` reads latest-game candidates.
- `scripts/import-hardware-catalog.ts`, `scripts/seed-hardware-catalog.ts`, and `scripts/verify-hardware-catalog.ts` consume hardware catalog data.
- Ingest workers then enrich seeded skeleton games through `lib/server/ingest-game.ts` and media helpers.

## AI Rules
- Treat seed files as data inputs, not generated noise. Do not reformat huge JSON files casually.
- Do not add secrets, private dump paths, or API responses that include credentials.
- Keep field names aligned with the scripts that consume them.
- For large data refreshes, explain source, date, and transformation path in the script or commit message.
- Prefer small sample fixtures for tests instead of loading huge seed files.

## Common Changes
- Adding a new seed dataset: add the JSON file, add or update a script that consumes it, and document expected fields in the script.
- Updating hardware catalog data: refresh the dataset, run import/verify scripts, and check normalization behavior.
- Updating latest games: refresh `latest-2025-2026.json`, run the import script, and verify queue/game rows.
- Shrinking or sampling data for tests: create a small sample instead of mutating large production-oriented seeds.

## Verification
- Run `npm run verify:hardware` after hardware dataset changes.
- Run the relevant seed/import script in dry-run or small-sample mode when available.
- Run `npm run test` for helper behavior that depends on seed shapes.
- Run `npm run lint` if script code changes with seed updates.

## Related Context
- `../scripts/context.md`
- `../lib/context.md`
- `../supabase/context.md`
- `../tests/context.md`
