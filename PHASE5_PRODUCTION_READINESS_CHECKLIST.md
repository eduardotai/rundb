# Phase 5: Production Readiness Checklist
**RunDB Real-Data Rollout (Master Implementation Plan aligned)**

This checklist prepares for flipping `NEXT_PUBLIC_USE_REAL_DATA=true` in production and completing the real-data migration for games, reports (reads + writes), stats, predictions, media, auth, and moderation foundations.

**Reference the approved Master Plan** (embedded in code comments across `lib/data.ts`, `app/actions/reports.ts`, `supabase/schema.sql`, `README.md`, `scripts/ingest-games.ts`, and `app/admin/page.tsx`):
- Gradual migration via feature flag with **always-safe fallbacks** to mock data.
- Schema + RLS + Server Actions/RPCs for security and anti-abuse.
- Phase 1: Ingestion (games + Storage media via IGDB/Steam/PCGW).
- Phase 2: Real reports submission (pending status, server-side tier, rate limits, dups, upvoting via report_votes + trigger).
- Phase 3: Real reads (async adapters + React Query in UI).
- Phase 4: Admin tooling foundations (demo → real via RLS).
- Phase 5: Full production enablement, observability, testing, safe rollout/rollback.

All items **MUST** be verified before enabling real data in prod. Use the data adapter (`lib/data.ts`) — it is the single source of truth.

## Pre-Deployment (Infra & Data)
- [ ] Supabase project created + production branch/DB (or use prod project).
- [ ] Full `supabase/schema.sql` applied (all tables, enums, indexes, triggers, RLS policies including Phase 1 media + Phase 2 moderator policies + RPCs for submit/upvote if preferred over Server Actions).
- [ ] Storage bucket `game-media` created (public, 10MB limit, image/* MIME) — see `lib/utils.ts:ensureGameMediaBucket` and `next.config.ts` remotePatterns.
- [ ] Auth providers enabled (Anonymous + at least Google/Discord; Email if desired). Profiles auto-created via trigger.
- [ ] At least one user promoted to `moderator` or `admin` role via SQL: `UPDATE profiles SET role='admin' WHERE id='...';`
- [ ] Point-in-time recovery (PITR) / backups enabled in Supabase Dashboard.
- [ ] Environment variables set in hosting platform (Vercel/Netlify/etc.):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only, never client)
  - `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` (for any re-ingestion; optional post-seed)
  - `NEXT_PUBLIC_USE_REAL_DATA=true` (set **last**, after verification)
- [ ] Production build succeeds (`npm run build`) with flag=true in a staging env first.
- [ ] Custom domain + SSL configured (if applicable). CORS / redirect URLs updated in Supabase Auth.

## Data Seeding & Ingestion (Phase 1 Complete)
- [ ] Run real ingestion: `npm run ingest:games` (or via `/admin` Phase 1 UI trigger generating CLI) against prod Supabase (service role key).
  - Verify 10+ games in `games` table + `game_media` rows + `cover_url` pointing to Storage public URLs.
  - Re-run is idempotent (upsert on slug).
- [ ] Verify media delivery: covers load via Next.js `<Image loader={gameMediaLoader}>` (webp/avif transforms, long cache).
- [ ] Spot-check `getAllGames()` / `getGameBySlugAsync()` return real data (no fallback warnings in logs).
- [ ] (Optional) Enrich with Steam/PCGamingWiki if needed via script updates.
- [ ] No PII or copyrighted full-text in DB beyond approved metadata.

## Real Reports & Submission Flows (Phase 2)
- [ ] Test `submitReportAction` (via UI or direct): creates with `status='pending'`, server-computed `performance_tier`, anti-abuse (5/hr rate limit + 24h exact dup for auth users).
- [ ] Verify anon submissions allowed (lighter protection).
- [ ] Upvoting works: inserts to `report_votes`, trigger updates `helpful_votes` (UNIQUE prevents dups).
- [ ] RLS policies active:
  - Public: only `status='approved'` reports visible.
  - Auth users: insert own reports.
  - Moderators/admins: SELECT/UPDATE all reports.
- [ ] Existing reports (if any seed) approved via `/admin/reports` or SQL (or plan a moderation pass post-flip).
- [ ] `addUserReport` / `upvoteReport` in `lib/data.ts` route to real Server Actions when flag=true.

## Reads, Stats, Predictions & UI (Phase 3)
- [ ] All real async paths exercised and working (with fallbacks on error):
  - `getAllGames()`, `getGameBySlugAsync()`
  - `getReportsForGameAsync()`, `getAllReportsAsync()`, `getFilteredGlobalReportsAsync()`
  - `computeGameStatsAsync()`, `predictForUserRigAsync()`
  - `useGames()` hook
- [ ] Game detail pages (`/games/[slug]`) use React Query for reports + stats; optimistic updates + invalidation on submit.
- [ ] Filters, sorting, compatibility checker, global reports browser all function on real data.
- [ ] No performance regressions (leverage existing indexes: `idx_reports_game_created`, `idx_reports_status`, etc.).
- [ ] My Reports (`/my-reports`), profile rig, submit flows updated or gracefully handle pending status.
- [ ] All components import from `lib/data.ts` (not direct mock) where possible.

## Admin & Moderation (Phase 4 Foundations → Real)
- [ ] `/admin` page: role simulation replaced or augmented with real `profiles.role` checks (via Server Components/Actions + RLS).
- [ ] Real moderation queue: `moderateReportAction` enforces server-side role check.
- [ ] Bulk import / hardware aliases / image review paths migrated or clearly marked as Phase 4 demo (future real via Supabase).
- [ ] Audit: moderator actions set `moderated_by`, `moderated_at`, `moderator_notes`.
- [ ] Access control: middleware or page guards prevent non-mods from sensitive actions (defense-in-depth with RLS).

## Security, Compliance & Ops
- [ ] No secrets in client bundles or git (verify `SUPABASE_SERVICE_ROLE_KEY` only server-side).
- [ ] RLS policies reviewed and tested (anon vs auth vs mod).
- [ ] Rate limiting + dup detection active (no abuse vectors).
- [ ] Image uploads (future) respect ownership via report_images RLS.
- [ ] GDPR/CCPA considerations for user reports/rigs (right to delete via user_id).
- [ ] Error boundaries + logging in place for real paths (see Monitoring guidance).
- [ ] CSP / headers configured for Supabase/IGDB/Steam domains if strict.
- [ ] Dependency audit (`npm audit`) clean for prod.

## Feature Flag & Gradual Rollout Strategy
- [ ] Deploy with `NEXT_PUBLIC_USE_REAL_DATA=false` (full mock, zero risk).
- [ ] Smoke test prod (all UI flows, no console errors).
- [ ] Enable flag for internal team / 5% traffic (canary) via hosting env or future LaunchDarkly-style.
- [ ] Monitor fallback logs (`[data] ... falling back to mock`) — zero or near-zero in prod.
- [ ] Watch error rates, query times in Supabase logs + new monitoring.
- [ ] Full enable only after 24-48h stable canary + checklist sign-off.
- [ ] Document flag toggle in runbook / incident response.

## Testing & Validation
- [ ] Local + staging with flag=true passes manual flows (submit, upvote, filter, predict, admin mod).
- [ ] Phase 5 E2E harness (`scripts/phase5-e2e-real-data.ts`, PR 6 extended with real image assertions in `testGameMediaAndImageAssertions`) passes against prod-like Supabase (incl. game_media + real covers + delivery).
- [ ] Load test key queries (e.g. reports for popular game) if scale expected.
- [ ] Fallback paths explicitly tested (e.g. simulate Supabase outage → mock returned, UI unbroken).
- [ ] Visual regression / a11y spot checks (ProtonDB-inspired dense UI).
- [ ] Rollback procedure rehearsed (see separate ROLLBACK_PLAN.md).

## Monitoring, Alerts & Observability (see PHASE5_MONITORING_SETUP.md)
- [ ] Sentry installed + configured for Next.js (error boundaries, Server Actions, data adapter catches).
- [ ] Supabase usage alerts configured (DB size, Storage, MAU, API requests, egress).
- [ ] Custom metrics: fallback rate, submit success, moderation queue depth, query latency (via Sentry or Supabase + logs).
- [ ] Uptime / health checks for Supabase project + hosting.

## Post-Flip / Go-Live
- [ ] Announce to community (if applicable).
- [ ] Monitor first 72h closely.
- [ ] Plan Phase 6 items (full admin real migration, advanced similarity via hardware_aliases, report images upload, RPC preference over Server Actions where beneficial, analytics).
- [ ] Archive mock-heavy code paths over time (keep adapter for safety).
- [ ] Update README.md with "Production: Real data enabled" note + link to these artifacts.

**Sign-off required from:**
- Eng (data layer + RLS)
- Ops (infra, monitoring, backups)
- (If applicable) Security review

**Last updated:** 2026-05-26 (PR 6 / Agent 6 final verification, docs, 6-agent swarm, E2E image extensions, dead code clean)

**How to use:** Copy to Notion / Linear / GitHub issue. Check items as completed. Link evidence (screenshots, query results, logs).

Failure to complete any item = do not flip the flag.

## Final Verification Swarm: 6-Agent Plan & Prompts (PR 6 / Agent 6 — Verification, Docs, E2E, Final)

**Purpose**: Prepare for final independent audits (by AI reviewer agents or experts) of the *full implementation* against the **approved Master Plan** once main work is closer to complete (e.g. after core real-data paths, ingestion, submission, reads, rigs, basic admin land; pre- or post- flag canary). This swarm (now 6 agents) runs in parallel to (and complements) the existing `scripts/phase5-e2e-real-data.ts` harness (extended in PR 6 with real image/media assertions in `testGameMediaAndImageAssertions`) and this checklist.

**PR 6 Deliverables (Agent 6 scope)**: Updated all PHASE5 docs; extended E2E for real image assertions (game_media RLS, non-fallback covers, HEAD delivery, media_type); created canonical `VERIFICATION_SWARM_PROMPTS.md` (6 specialized prompts); produced final aggregate report + gallery instructions; cleaned dead agent telemetry code; worktree-ready final state + this comprehensive verification.

See the canonical prompts + process in `VERIFICATION_SWARM_PROMPTS.md` (created PR 6). The original 5 prompts are preserved there for reference + the new 6th (E2E/Image/Media/Gallery).

**Approved Master Plan (reviewers MUST internalize these sources first)**:
- `supabase/schema.sql` (header: "Consolidated from Master Implementation Plan (approved)"): full enums (performance_tier, graphics_preset, report_status), tables (games, profiles, user_rigs, reports with moderation/denorm/status, report_votes, report_images, hardware_aliases, game_media Phase1), indexes (critical for reports/game queries), triggers (updated_at, helpful_votes via votes, new-user profile), RLS policies (detailed public/owner/mod), RPCs (submit_report with rate limit 5/hr + 24h dup + tier calc, upvote_report, calculate_performance_tier).
- This file (`PHASE5_PRODUCTION_READINESS_CHECKLIST.md`): 5 phases (1 Ingestion/games+Storage media via IGDB/Steam/PCGW + game_media; 2 Real reports submission+anti-abuse+mod foundations; 3 Real reads/stats/predictions + React Query UI; 4 Admin real; 5 Prod enable/observability/safe rollout/rollback), gradual `NEXT_PUBLIC_USE_REAL_DATA` flag + *always-safe* mock fallbacks in adapter, infra/auth/RLS/seed/monitoring requirements.
- `PHASE5_ROLLBACK_PLAN.md` (flag-based zero-downtime escape hatch, RLS-specific recovery) + `PHASE5_MONITORING_SETUP.md`.
- `README.md` (phased real-data migration start, Phase 1 ingestion, tech stack, original mock demo).
- `lib/data.ts` (extensive "Master Plan aligned" / "per Master Plan" comments): single source of truth adapter, DB<->type mappers (snake->camel), async real paths (get*Async, compute*Async, predict*Async, addUserReport, upvoteReport, load/saveMyRigAsync) with try/catch + mock fallback + console.warn, sync wrappers for compat, React hooks (useGames), rig via user_rigs+profiles, admin still mock (Phase4).
- `app/actions/reports.ts` ("Aligned strictly with Master Implementation Plan + approved schema"): submitReportAction (pending status, server tier, rate/dup checks, game_name denorm), upvoteReportAction (via report_votes + trigger), moderateReportAction (server role check via profiles), getReportByIdForMod.
- `lib/types.ts` (1:1 with schema, Phase2 moderation fields, SubmitReportInput, AdminReport, etc.).
- Supporting: `scripts/ingest-games.ts` (Phase1, service_role only, idempotent upsert, media pipeline), `scripts/phase5-e2e-real-data.ts` (adapter + RLS + flows + anti-abuse tests), `app/admin/page.tsx` (demo role sim + mock data; notes real migration pending for profiles.role + moderation queue), `middleware.ts` (auth session refresh, no hard route guards yet), `lib/supabase/{client,server}.ts` (anon key client-side for RLS), `app/globals.css` (ProtonDB-inspired theme + tier vars + dense report cards), components/ (report-card, performance-badge, etc.), `app/` pages (React Query usage in home + game detail for Phase3), `lib/utils.ts` (media bucket + optimize).
- Core principles: feature flag for gradual zero-risk migration (real never breaks UI), RLS as primary security + server defense-in-depth, schema as source-of-truth, performance via indexes/denorm/server calc/RQ, UI dense/scannable premium data experience.

**Lightweight Swarm Process** (independent agents, no cross-communication):
1. Prep: Run updated E2E harness (incl. PR 6 image assertions) + note current checklist state + build + any recent diffs. Provide reviewers workspace access (or targeted file reads) + the Master Plan refs above + `VERIFICATION_SWARM_PROMPTS.md`.
2. Launch **6 parallel independent reviewer agents** (one per focus). Paste the exact prompt for their role + any state summary (from `VERIFICATION_SWARM_PROMPTS.md`).
3. Each agent uses tools (grep/read_file etc.) for exhaustive analysis. Produces *only* the structured report.
4. Agent 6 (Orchestrator) aggregates reports: dedupe findings, assign owners, update this checklist (add findings section + "Verification Swarm Results (PR 6)" subsection), produce `FINAL_AGGREGATE_VERIFICATION_REPORT.md` + gallery, file issues/PRs.
5. Re-audit targeted areas after fixes. Full swarm sign-off required for Phase 5 flag enable (alongside Eng/Ops/Security).
6. Archive: attach reports + aggregate + gallery artifacts to this file, `VERIFICATION_SWARM_PROMPTS.md`, or issue tracker.

**Output Format (required for every reviewer report)**:
** [FOCUS AREA] Audit Report **
**Executive Summary:** (1-2 sentences: adherence level + #blockers/#warnings)
**Master Plan Alignment:** (table or bullets per sub-area: Full / Partial / Gap)
**Detailed Findings:** (bullets with exact `file:line` or `schema.sql:policy-name` refs)
**Gaps vs Approved Master Plan:** (prioritized list)
**Risks & Potential Impact:**
**Recommendations (P0 blocker / P1 high / P2 nice-to-have):**
**Evidence:** (key code/SQL snippets or query results; do not paraphrase)
**Confidence / Limitations:**

**Reviewer Roles & Self-Contained Prompts**:
The complete, up-to-date **6-agent prompts** (Prompts 1-5 preserved from prior + new Prompt 6 for E2E/Image/Media/Gallery + Orchestrator duties) live in the canonical file:

**`VERIFICATION_SWARM_PROMPTS.md`** (created + maintained in PR 6 / Agent 6).

**Always use the prompts from that file** for launching the swarm (it is the single source of truth post-PR 6 and includes gallery instructions in Prompt 6 + aggregate template).

**End of Verification Swarm Section** (see `VERIFICATION_SWARM_PROMPTS.md` for full details + PR 6 extensions).

**Post-Swarm Actions (PR 6 / Agent 6)**:
- Add a "Verification Swarm Results (PR 6)" subsection here after run (link to `VERIFICATION_SWARM_PROMPTS.md` + all 6 raw reports + `FINAL_AGGREGATE_VERIFICATION_REPORT.md` + gallery).
- Update "Last updated" date across all PHASE5 docs.
- Agent 6 produces final aggregate + gallery instructions (executed in this PR).
- Only proceed to full Phase 5 enablement after swarm + E2E (with images) + checklist all green.

This swarm ensures the final implementation *exactly* matches the approved Master Plan before production real-data flip.
