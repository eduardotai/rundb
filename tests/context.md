# tests Context

## Purpose
`tests/` contains Node test runner coverage outside the `lib/` colocated tests. It focuses on pure logic and ingestion/server helper behavior that does not require a browser.

## Read This First
- `chart-helpers.test.ts`: chart data expectations for performance summaries.
- `cover-candidates.test.ts`: cover/media candidate selection behavior.
- `discover-steam-games.test.ts`: Steam discovery helper behavior.
- `igdb-game-match.test.ts`: IGDB/game matching behavior.
- `report-input.test.ts`: the shared report schema (`lib/report-input.ts`): ranges, types, enums, unknown keys, sanitizing, auto-review reasons.
- `report-write.test.ts`: `lib/server/report-write.ts` with fakes: tampered payloads, auth, ownership, rate limit, duplicates, pending/approved decisions on submit and edit.
- `report-public-reads.test.ts`: static guard that public report reads in `lib/data.ts` filter `status = 'approved'`.
- `action-result.test.ts`: result-value helper for Server Actions and a static check that admin/vote/moderation actions return `ActionResult`.
- `report-vote.test.ts`: `lib/server/report-vote.ts` (auth, input checks, friendly DB error mapping).
- `admin-moderation.test.ts`: drives `lib/server/admin-moderation.ts` with an in-memory Supabase stub (RPC payloads, dedup, audit rows, bulk import) and guards the security shape of `supabase/migrations/20261109000400_admin_moderation.sql`.
- Also check colocated `lib/*.test.ts` files for auth redirect, hardware detection, normalization-adjacent behavior, report notes, sanitization, similarity, Steam helpers, and trending.

## Main Responsibilities
- Verify pure functions and data transformations without requiring Supabase, the browser, or a running Next server.
- Protect ingestion matching and media helper behavior from regressions.
- Keep hardware, similarity, chart, report-note, auth-redirect, sanitization, and trending logic stable.
- Provide fast feedback through the built-in Node test runner via TSX.

## Data Flow
- Tests import helpers from `lib/` and `lib/server/` where the code can run without real service credentials.
- Seed fixtures may come from `seeds/` or small inline examples.
- App routes and component behavior are not heavily covered here; visual/browser verification is manual or separate.
- Pure logic should be written so it can be tested here before being called by `app/` or `components/`.

## AI Rules
- Prefer focused tests for new pure logic, mappers, filters, calculations, parsers, and matching heuristics.
- Do not write tests that require real Supabase credentials unless explicitly building an integration check script instead.
- Keep test names behavior-oriented and stable.
- Use `node:test`/TSX patterns already present in the repo.
- If a regression touches a colocated `lib/*.test.ts`, update the colocated test rather than forcing everything into `tests/`.
- Avoid snapshot-style assertions for data that changes often; assert the important normalized fields or rankings.

## Common Changes
- New chart helper: add or update `tests/chart-helpers.test.ts`.
- New cover candidate behavior: update `tests/cover-candidates.test.ts`.
- New Steam/IGDB matching behavior: update the relevant test file in `tests/` or `lib/`.
- New hardware parser or similarity rule: update colocated `lib/hardware-detector.test.ts` or `lib/similarity.test.ts`.
- New sanitizer/report note behavior: update colocated `lib/sanitize.test.ts` or `lib/report-notes.test.ts`.

## Verification
- Run all tests with `npm run test`.
- Run a focused test with `npx tsx --test tests/<file>.test.ts` or `npx tsx --test lib/<file>.test.ts`.
- Run `npm run lint` after TypeScript test edits.

## Related Context
- `../lib/context.md`
- `../scripts/context.md`
- `../seeds/context.md`
- `../supabase/context.md`
