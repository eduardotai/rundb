# lib Context

## Purpose
`lib/` owns RunDB's data adapter, domain types, pure logic, Supabase wrappers, hardware catalog and detection logic, cover/media helpers, server-only ingestion utilities, and shared utilities.

## Read This First
- `data.ts`: the central adapter and public facade for app/components. It owns real-vs-mock behavior, mapping, React Query hooks, enrichment, saved rigs, reports, games, and admin delegation.
- `types.ts`: source-of-truth TypeScript shapes that mirror Postgres concepts and UI payloads.
- `mock-data.ts`: zero-config data, localStorage persistence, pure compute/filter/predict helpers, and mock admin state.
- `supabase/client.ts`, `supabase/server.ts`, `supabase/service.ts`, `supabase/query-stub.ts`, `supabase/auth-timeout.ts`: defensive Supabase clients and auth timeout behavior.
- `hardware-catalog*.ts`, `normalize-hardware.ts`, `hardware-detector.ts`, `hardware-similarity-heuristics.ts`, `similarity.ts`: hardware catalog, aliases, detection, normalization, and similarity.
- `game-cover-*`, `game-id-resolver.ts`, `cover-image-url.ts`, `server/game-media.ts`: cover, media, and external ID resilience.
- `server/*`: service-role and server-only helpers for ingest, queues, dashboard data, profiles, and cover candidates.

## Main Responsibilities
- Centralize data access so app and component code can stay thin and resilient.
- Support dual mode: `NEXT_PUBLIC_USE_REAL_DATA=true` plus Supabase keys uses real Postgres/RLS; missing flags or errors fall back to mock/local behavior.
- Keep pure logic reusable across mock and real data by mapping database rows into shared TypeScript shapes before computing.
- Provide client-safe hooks and async helpers for games, reports, stats, predictions, saved rigs, devices, covers, hardware catalog, and admin utilities.
- Protect server-only operations behind server modules, dynamic imports, route handlers, server actions, or scripts.
- Keep catalog, cover, and auth behavior defensive so the app does not hang or crash when external services are missing or slow.

## Data Flow
- `app/` and `components/` normally import from `@/lib/data`.
- Real read paths dynamically import Supabase clients, fetch snake_case rows, map to camelCase domain types, and call shared pure helpers.
- Mock paths use `mock-data.ts` arrays and localStorage keys for zero-config demos.
- Reports submit through `app/actions/reports.ts`, which uses normalization helpers and Supabase RPCs.
- Server-only ingestion and admin maintenance use `lib/server/*` and service-role Supabase, not the public adapter.
- Hardware flows from catalog/static data plus optional live `hardware_catalog` rows into comboboxes, normalization, detection review, reports, rigs, and similarity scoring.
- Cover flows layer static catalog, DB cover fields, resolvers, and batched `game_media` queries to avoid N+1 fetches.

## AI Rules
- Treat `lib/data.ts` as the main boundary. Do not bypass it from product UI unless the code is explicitly server-only and needs privileged behavior.
- Keep public client bundles free of service-role code.
- Preserve defensive fallbacks. Missing Supabase env, dead auth, empty tables, or fetch errors should degrade to mock/demo behavior where the existing architecture expects it.
- Prefer async helpers and React Query hooks for new user-facing data access.
- When adding persistent fields, update `types.ts`, database schema/RPCs, row mappers, action payload builders, components, and tests together.
- Keep pure calculations independent from Supabase so tests can run without external services.
- Respect fetch caps and batching patterns; do not introduce unbounded report/media queries on catalog pages.

## Common Changes
- New report property: add to `Report`/`SubmitReportInput`, mapper functions, `submit_report` RPC/action payload, forms, cards, and tests.
- New game metadata field: update `Game`, DB schema, ingest mapper, cover/enrichment behavior if relevant, UI consumers, and seeds/scripts.
- New prediction heuristic: edit pure prediction/similarity helpers and add focused tests.
- New hardware source or parser: extend `hardware-detector.ts`, normalization/catalog helpers, UI review flow, and tests.
- New server ingest capability: add or update `lib/server/*`, wire from `scripts/` or `app/actions/*`, and keep service-role access server-only.
- New Supabase access path: decide whether it belongs in the public adapter, server action, route handler, or server-only helper before coding.

## Verification
- Run `npm run test` for pure logic, mappers, hardware, cover, auth redirect, chart, and ingest helper changes.
- Run `npm run lint` for TypeScript and React boundary checks.
- Run `npm run build` when touching data adapter imports, Supabase wrappers, Next server/client boundaries, or types used broadly.
- For scripts/server helpers, run the focused script in dry-run mode when available.

## Related Context
- `../app/context.md`
- `../components/context.md`
- `../scripts/context.md`
- `../supabase/context.md`
- `../tests/context.md`
