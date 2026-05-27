# Phase 7 Planner Agent #4: Integration, Parity, Testing, Admin & Rollout Plan

**Focus:** Safe Integration of Community Hardware Similarity atop Phase 6 Catalog/Validation; Full Anonymous/Real-Data Parity Matrix; Comprehensive Testing (Unit/Integration/E2E/Parity); Admin Tooling Extensions; Responsible Feature Flag & Rollout Strategy; Remediation of Prior Critical Issues (RLS Bypass, loadUserReports Gap, Flag Discipline, Observability, Worktree Divergence Risks); Documentation & Contributor Handoff

**Date:** 2026-05-26  
**Status:** Planning complete. Coordinates 1:1 with Phase 6 MASTER + Planners 1-4 (Hardware Validation) + Phase 7 Planners #1 (Similarity Engine) and #2 (UI Surfaces). Realistic assessment of pre-existing state included.

**Prerequisites (Non-Negotiable):** Phase 6 hardware catalog + validation (static `lib/hardware-performance-catalog.ts`, `HardwarePerfEntry`, `perfIndex`, `validateHardwarePerformance`, `HardwareValidationResult`, `CATALOG_VERSION`, `getCanonicalHardware`, RigHealthCard/RigConsistencyPanel/HardwareMatchBadge/PlausibilityIndicator per Planner 3, admin catalog tab + moderatorNotes enhancements per Planner 4) must be fully implemented, reviewed, and landed in main **before** any Phase 7 code. Phase 7 Planner #1 engine and #2 surfaces depend directly on it.

---

## 1. Executive Summary & Realistic State Assessment

**Core Objective:** Deliver the full "Community Hardware Similarity" experience (enhanced predictions, similar-hardware reports sections, percentiles, distributions, richer Rig Consistency + My Reports, education) while guaranteeing **100% behavioral parity** across:
- Anonymous Supabase users (auth.uid() present but no email) + full authenticated users
- Guest / local-only (no auth, localStorage `rundb_my_rig` + `rundb_user_reports`)
- `NEXT_PUBLIC_USE_REAL_DATA=false` (mock/localStorage) vs `=true` (Supabase + RLS + Server Actions)
- Offline / no-network scenarios (pure functions + cached data)

All new surfaces must compose cleanly with Phase 6 validation (plausibility gate on submit) as its positive mirror (empirical community matching).

**Critical Realism Check (Post Full Codebase + Plan Inspection, 2026-05-26):**
- **Phase 6 implementation status:** ZERO code present in working tree. Grep for `hardware-performance-catalog`, `HardwarePerfEntry`, `validateHardwarePerformance`, `perfIndex`, `CATALOG_VERSION`, `RigConsistencyPanel`, `HardwareMatchBadge` etc. returns **matches exclusively inside the 5 Phase 6 plan files** (MASTER + planners-1-4) and the two existing Phase 7 planner files (which reference the planned catalog). No `lib/hardware-performance-catalog.ts`, no wiring in `app/actions/reports.ts`, `components/submit-report-dialog.tsx`, `app/admin/page.tsx`, etc.
- **"4 separate worktrees with divergence":** `git worktree list` shows **only main** (`1d70d86 [main]`). The MASTER plan (§3, §6) *recommended* isolated worktrees for 4 parallel implementers (A=Catalog, B=Submit+Dialog, C=Admin+DB, D=UX+MyRig+Docs) + later 4 reviewers. No evidence such worktrees were ever created or merged in this environment. Any "divergence" is hypothetical until execution begins. **Source of truth must be the coordinated plans themselves** (they show strong agreement; no material conflicts noted in MASTER).
- **Reviewer reports from "recent swarm":** Exhaustive filesystem + content search (`grep -r` variants across *.md, full dir) found **no Phase 6 reviewer reports or aggregate** (unlike `FINAL_AGGREGATE_VERIFICATION_REPORT.md` and `EXECUTION_CLOSING_REPORT.md` which exist for the prior banner/media PR 6 work). The plans *define* what the 4 reviewers should focus on (Planner 4 §4.3: Reviewer 1=Admin/Mod/RLS, 2=Parity/Testing, 3=Rollout/Security/Observability/bypass prevention, 4=Docs/Education). Critical issues cited in this prompt (RLS bypass, loadUserReports, feature flag gaps, worktree divergence) were **reverse-engineered via direct inspection** of current main + cross-referenced against plan language (e.g., repeated emphasis on "no client bypass", "static for parity", "RLS unchanged", "Reviewer 3: security (bypass prevention), flag discipline").
- **Pre-existing critical blockers (must be owned in Phase 7 #4):**
  1. **RLS bypass (profiles table, supabase/schema.sql:231-232):** `"Users can view and update own profile" FOR ALL USING (auth.uid() = id);` — **no WITH CHECK restricting `role`**. Any logged-in user (incl. anon auth) can `UPDATE profiles SET role='admin' WHERE id=auth.uid()`. This completely undermines Phase 6 moderatorNotes/`flagged` + future similarity admin tools and real admin page. Server actions (moderateReportAction, triggerIngestionAction) have defense-in-depth role checks, but client/admin UI and RLS policies trust the (bypassable) role. **P0 blocker for any real-mode Phase 6/7 features.**
  2. **loadUserReports gap (lib/data.ts:658-660):** `export function loadUserReports() { return mock.loadUserReports() }` — **unconditional mock delegation**. Real path for owner-owned reports (critical for `app/my-reports/page.tsx`, RigConsistencyPanel "validate my past reports", Phase 7 community vs own data, outlier detection) does not exist. `addUserReport` branches correctly (real → submitReportAction), but reads of "my reports" do not. Breaks parity for logged-in users in real mode. Plans (planner-3, planner-4) *assume* it is already branched ("data adapter already branch... loadUserReports").
  3. **Feature flag & admin gaps:** `app/admin/page.tsx` remains 100% demo (`demoRole` localStorage switcher + explicit amber banner "No real database writes occur yet" + "In production this page would enforce..."). All admin paths (including planned Performance Catalog tab) delegate to mock even when `USE_REAL=true`. Real role enforcement lives only in actions. `loadMyRig`/`saveMyRig` etc. emit warnings but still mock. No dedicated similarity flag planned yet.
  4. **Observability / monitoring:** No Sentry or production alerts wired (per PHASE5_MONITORING_SETUP references in prior artifacts). New similarity scoring fallbacks, catalog miss rates, validation mismatch volume, and perf of `findSimilar*` on large per-game sets have zero visibility.
  5. **Parity debt:** Existing `predictForUserRigAsync` / `calculateSimilarity` (mock-data.ts:573-642, data.ts:592-617) already delegate correctly for reports fetch + pure scoring, but the above gaps + dual persistence (user_rigs + profiles.main_*) + always-mock loadUserReports create drift for "my data" surfaces.
- **Positive foundation:** Data adapter pattern (`USE_REAL` at lib/data.ts:40, dynamic imports for actions, safe fallbacks + warnings) is excellent and proven. Pure functions (existing predict + planned catalog) guarantee offline/anon parity. RLS on reports (approved public, owner insert, mod via profiles.role EXISTS) is mostly sound *except* the profiles self-escalation hole. Schema + indexes ready for Phase 6 table addition. Strong verification culture (PHASE5_* docs, VERIFICATION_SWARM_PROMPTS.md structured format, e2e script, rollback via flag flip).

**Conclusion:** Phase 7 cannot be "built on top of Phase 6" safely until Phase 6 lands **and** the above criticals are remediated (or explicitly worked around with documented tech debt + monitoring). This plan treats remediation as **Phase 7 #4 P0 workstream** (or explicit pre-requisite gate). Plans are the contract; worktree divergence risk is mitigated by "plan-first, main as single source after reconciliation".

**Phasing within Phase 7 (this planner owns integration/ship discipline):**
- **7.0 Remediation Gate (this plan):** Fix RLS bypass, implement real `loadUserReports` (and `loadUserReportsForCurrentUser`), wire minimal real admin role enforcement + catalog viewer skeleton, add basic observability hooks, confirm full parity matrix on existing surfaces.
- **7.1 Engine + Catalog Land (Planner #1 primary, this plan integration support):** Catalog + validation + similarity engine pure fns.
- **7.2 UI Surfaces (Planner #2 primary):** Game pages, checker, ReportCard, RigConsistency enhancements.
- **7.3 Admin + Rollout (this plan primary):** Full admin tooling (catalog CRUD + similarity analytics), flag rollout (dark → soft → full), extended testing/swarm, docs.
- **7.4 Polish & Production Enablement:** Full matrix sign-off, canary, monitoring live.

All invariants from Phase 6 preserved: additive (validation never replaced), non-accusatory/educational tone, server authoritative where enforcement matters, static catalog for hot paths + parity, O(1) pure functions preferred.

---

## 2. Source of Truth Reconciliation & Worktree Strategy (Addressing "4 Phase 6 Worktrees with Divergence")

**Current Reality:** No divergent worktrees exist in this checkout. MASTER explicitly called for worktree isolation ("isolation: 'worktree'") for 4 implementers to avoid merge conflicts during parallel catalog/submit/admin/ux work. Because none were created/merged here, **the 4 Phase 6 planner documents + MASTER are the single, authoritative, coordinated source of truth**. They were produced in a single synthesis pass and show "strong agreement" (MASTER §1).

**Recommended Reconciliation Approach (if prior worktrees or branches ever surface):**
1. **Do not merge divergent worktrees blindly.** Create a dedicated `reconcile-phase6` branch off latest main.
2. **Diff each worktree against its corresponding planner** (use `git diff --stat` + manual review of core files: catalog.ts vs planner-1 spec, submitReportAction vs planner-2 exact line diffs, admin tab vs planner-4 sketches, RigConsistencyPanel vs planner-3 wireframes).
3. **Choose "blessed" artifacts:** Prefer the version that most closely matches the *plan text* (verbatim function signatures, constants, insertion points, non-breaking additive changes, exact moderatorNotes format, wide tolerance bands 0.43x-2.28x etc.). Plans win on conflicts.
4. **Cherry-pick or manual port** only clean, plan-aligned hunks. Any "creative improvements" or un-planned refactors must be justified in PR description and reviewed by at least one planner author equivalent.
5. **Run full verification swarm** (updated prompts from VERIFICATION_SWARM_PROMPTS.md + this plan's matrix) on the reconciled tree before any Phase 7 work.
6. **If divergence is severe:** Treat as "no Phase 6 landed" and execute the 4 impl agents *sequentially or in tightly coordinated pairs* on main (catalog first as unblocker) using the plans as immutable spec. This is lower risk than reconciling unknown state. Update MASTER with "Execution Note: Worktrees not used; sequential on main per Phase 7 #4 recommendation."
7. **Prevention for Phase 7:** For any future Phase 7 parallel work (e.g., engine vs surfaces vs admin), require **all agents to start from the exact same main + latest plans/** snapshot. Mandate daily "plan delta" checks. Use conventional commits that reference planner sections. This planner (#4) owns the integration branch that lands everything.

**Decision:** Until Phase 6 code lands cleanly on main matching the plans, Phase 7 implementation agents (when spawned) must treat plans as contract and may **not** assume any worktree artifacts. This plan (and future updates) becomes the integration overlay.

---

## 3. Integration Strategy with Catalog, Validation, and Existing Codebase

**Dependencies (Hard):**
- Phase 6 catalog (`lib/hardware-performance-catalog.ts` exporting `GPU_CATALOG`, `CPU_CATALOG`, `CATALOG_VERSION`, `getHardwarePerf`, `getCanonicalHardware`, `validateHardwarePerformance`, `estimateExpectedFps`, `getRigPerfScore` etc.) **must exist and be re-exported via `lib/data.ts`** before Planner #1 similarity engine or any Phase 7 UI.
- Phase 6 submit wiring (post-dup validation in `submitReportAction`, client banner in submit-report-dialog) + admin catalog viewer tab (read-only Phase 1) + moderatorNotes rich parsing.
- Phase 6 UX components (RigHealthCard, RigConsistencyPanel base, HardwareMatchBadge, PlausibilityIndicator, HowWeValidateInfo) per Planner 3.
- Existing adapter, types (Report, UserPC, SubmitReportInput, ReportStatus including 'flagged'), pure helpers in mock-data (calculateSimilarity kept for compat), RQ hooks.

**Additive, Non-Breaking Rules (enforced in all Phase 7 diffs):**
- New similarity engine (`lib/hardware-similarity-engine.ts` or co-located per Planner #1 §2) imports catalog; exports `calculateHardwareSimilarity`, `findTopSimilarReports`, `getPerformanceDistributionForSimilarRigs`, `computePercentileAmongSimilar`, `getRigPerfScore` (or enhanced), `SimilarHardwareResult` etc.
- Existing `calculateSimilarity` / `predictForUserRigFromReports` / `predictForUserRigAsync` remain exported forever (or deprecated with JSDoc). New engine becomes primary scorer inside them (or parallel "v2" path during dark launch).
- `lib/data.ts`: Add thin async wrappers (`getSimilarHardwareReportsForGameAsync`, `computeSimilarHardwareStatsAsync`, `useSimilarHardwareReports`) that fetch via existing `getReportsForGameAsync` (RLS-respecting) then call pure engine. Re-export all new pure fns. Never duplicate logic.
- No changes to hot submit path (similarity is read-only post-facto; optional enrichment of moderatorNotes with "closest community similarity score" is Phase 7.2+ and additive).
- Schema: Phase 6 adds `hardware_performance` (public read RLS). Phase 7 may later add optional perf-bucket columns or materialized views for scale (non-breaking, behind migration comment). No changes to reports/user_rigs/profiles for MVP.
- Real vs mock: Pure engine always identical. Async paths branch only on fetch (reports + my-rig via adapter).

**Sequencing (this planner owns the critical path diagram):**
1. Remediation (see §6) + Phase 6 catalog land (A first per MASTER).
2. Phase 6 validation wiring + basic admin tab.
3. Phase 7 #1: Engine + predict enhancements + types (unblocks #2 and this planner's admin surfaces).
4. Phase 7 #2: UI surfaces (game pages, checker, ReportCard, consistency panel updates).
5. This planner (#4): Admin similarity extensions (cluster stats, mismatch analytics), full parity test harness, flag rollout infrastructure, docs, swarm.
6. Parallel where safe (e.g., docs/education copy can start early).

**Risk of premature integration:** If Phase 7 code lands before Phase 6 catalog, it will either duplicate normalization logic or fail at runtime. Enforce via import guards or TODO comments that become compile errors.

---

## 4. Full Parity Matrix (Anonymous, Guest, Real Data, Offline)

**2×2×2 Matrix (Guest/Anon/Auth × Mock/Real × Online/Offline).** All cells must behave **identically** for core similarity + validation outcomes (modulo data source: LS seeds vs RLS-approved DB rows). Pure functions guarantee this.

**Matrix Table (to be executed in test harness + swarm):**

| Dimension          | Guest (no auth, LS only) | Anon Supabase Auth (user_id present, RLS) | Full Logged-in (email + role) | Offline (no net, flag=false or cache) |
|--------------------|---------------------------|---------------------------------------------|--------------------------------|---------------------------------------|
| **Catalog lookup / validateHardwarePerformance** | Static catalog (pure) | Same pure fn (client or server action) | Same | Fully offline (bundled TS) |
| **calculateHardwareSimilarity / findTopSimilar** | Pure on LS reports + LS rig | Pure on RLS-fetched approved reports + DB rig (via loadMyRigAsync) | Same + owner reports via real loadUserReports | Pure on whatever is cached in LS / RQ |
| **ReportCard "X% match" + hardware sim badge** | LS rig + LS user reports | Real reports (approved) + real my-rig; owner-gated plausibility uses real userId | Same | Degraded to last cached rig + last fetched reports |
| **CompatibilityChecker predictions + similar distribution** | Mock path + pure | Real fetch + pure engine | Same | Last prediction cached |
| **RigConsistencyPanel (own reports + community similar)** | LS rig + loadUserReports() (mock) + community LS | Real user_rigs + real loadUserReportsForCurrentUser() (RLS owner) + community RLS-approved | Same + mod view if role | Limited to LS data |
| **My Reports page (hardware match badges + percentile)** | LS only via loadUserReports | Real query for user_id = auth.uid() (must implement) | Same | Last snapshot |
| **Submit pre-warn (Phase 6) + post-submit flag** | Client pure warn + mock add (no status) | Client + server action (full validate, status=flagged, moderatorNotes) | Same + visible in real mod queue | Client only (server unreachable → graceful) |
| **Admin Performance Catalog viewer (Phase 6) + similarity analytics (Phase 7)** | demoRole localStorage + mock catalog | Real catalog table (if seeded) + role-checked action; demoRole ignored or secondary | Real + full mod/curator tools | Read-only static catalog export |
| **Education surfaces ("How we validate" + "How we match similar")** | Full (static copy) | Full | Full | Full (bundled) |

**Guarantees:**
- No network calls in pure engine or catalog.
- Real paths **never** expose non-approved reports to public/anon (RLS + status filter in data.ts `getReportsForGameAsync`).
- Owner "my reports" visible to self even if pending/flagged (existing owner SELECT policy + new real loadUserReports impl).
- Fallbacks identical: unknown hardware → mid perfIndex + capped similarity + explicit "partial catalog coverage" reason in UI.
- Catalog version surfaced everywhere (validation result, similarity explanation, admin header, education).

**Offline parity note:** With flag=true but no connectivity, components using RQ should surface stale data + "offline mode" banner (reuse existing patterns); similarity still runs on stale reports/rig.

---

## 5. Testing Strategy (Unit, Integration, E2E, Parity Tests, Swarm)

**Current Testing Reality (Honest):** No Jest/Vitest/Playwright in package.json or src (only manual + `scripts/phase5-e2e-real-data.ts` + swarm reviews + build/lint). This is inherited; Phase 7 does not introduce heavy test framework unless justified. Leverage existing harness + expand scripts.

**Layered Approach:**

1. **Pure Function Unit Tests (new `scripts/test-similarity-engine.ts` or inline in mock-data tests section):**
   - 15+ deterministic cases exercising catalog + engine: exact flagship match → 95+; 15 perfIndex GPU delta → ~78; unknown hardware cap; RAM delta penalties; resolution scaling; 1% low interaction (with Phase 6 validate); top-N ordering stability; fallback blending with legacy calculateSimilarity.
   - Micro-bench: `findTopSimilar(2000 synthetic reports) < 15ms` assertion (Node timing).
   - Run via `npx tsx scripts/test-*.ts` in CI or pre-commit.

2. **Integration (Adapter + Data Layer):**
   - Extend `lib/data.ts` re-exports with JSDoc parity notes.
   - New test script `scripts/test-parity-matrix.ts` that:
     - Mocks env flag + auth state.
     - Exercises every cell of §4 matrix against both mock and (when available) seeded real Supabase (via service role in script, never anon key leakage).
     - Asserts identical numeric outputs (scores, percentiles, canonicals) for same input rig + report set.
   - Assert real `loadUserReports` (post-fix) returns only owner rows + matches LS shape.

3. **E2E / Real-Data (extend existing):**
   - Update `scripts/phase5-e2e-real-data.ts` with `testHardwareSimilarityAndParity()` (new function modeled on `testGameMediaAndImageAssertions`).
     - Requires `NEXT_PUBLIC_USE_REAL_DATA=true` + seeded DB (ingest + some approved reports with varied hardware).
     - Submit reports with known rigs → save rig → assert similar reports surfaced have higher perfIndex match than random.
     - Consistency panel scan on own reports (post real loadUserReports) + community.
     - Validation flag on absurd submit + moderatorNotes visible in real admin queue.
     - Parity assertions: run same flows with flag=false (compare outputs where possible).
   - Headless browser smoke optional (if Playwright added later).

4. **Admin + Moderation Flow Tests:**
   - Manual + script: demoRole vs real role (after remediation). Assert server actions reject non-admins even if client demoRole=admin.
   - Catalog CRUD (Phase 2) + JSON import roundtrip.
   - Similarity admin tiles (mismatch rate, cluster coverage) populated from real data.

5. **Visual / UX Regression (swarm + manual):**
   - Per VERIFICATION_SWARM_PROMPTS + FINAL_AGGREGATE style: 12-shot gallery instructions updated for Phase 7 surfaces (similar hardware section on game page with/without rig, checker with distribution chart, ReportCard with perf % vs legacy, consistency panel tabs, admin catalog tab + new analytics, education accordions on mobile/desktop).
   - Dark/light, reduced-motion, high-contrast, 320px/768px/1440px viewports.
   - Color: emerald for positive similarity, amber for validation warnings (strict reuse of Phase 6 tokens).

6. **Swarm Review Process (this planner owns orchestration):**
   - Update `VERIFICATION_SWARM_PROMPTS.md` with Phase 7 roles (new Prompt 7: Similarity Engine + Parity Auditor; Prompt 8: Admin/RLS/Flag Auditor; Prompt 9: Rollout/Observability; Prompt 10: Docs/Education/UX Consistency).
   - Require 4+ specialist + aggregate report (modeled on existing FINAL_AGGREGATE) + updated PHASE5 checklist + this plan's matrix execution **before** any prod similarity flag flip or catalog deploy.
   - Explicit Reviewer 3-style focus in prompts: "bypass prevention (no client can skip validation or see unapproved data; profiles.role not self-escalatable)", "flag discipline", "observability before canary".

7. **Performance / Scale Gates:**
   - Synthetic 5k-report benchmark in test script (assert no O(N^2)).
   - Real E2E on largest game (post-ingest) measures similar-report query + score time < 200ms client.

**No new heavy deps** for MVP. If vitest added, it is post-Phase 7.1 non-blocking.

---

## 6. Remediation of Prior Critical Issues (Mandatory Workstream in This Plan)

**P0 — Must land before or with first Phase 7 code:**

**A. RLS Bypass Fix (profiles self-escalation) — supabase/schema.sql + actions**
- Add or replace policy:
  ```sql
  DROP POLICY IF EXISTS "Users can view and update own profile" ON profiles;
  CREATE POLICY "Users can view and update own profile (non-role)" ON profiles
    FOR ALL
    USING (auth.uid() = id)
    WITH CHECK (
      auth.uid() = id AND
      (role = (SELECT role FROM profiles WHERE id = auth.uid()) OR   -- cannot change role
       EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))  -- only admin can set any role
    );
  ```
- Or better: separate `role` management to a SECURITY DEFINER RPC `set_user_role(target_user uuid, new_role text)` callable only by existing admins (enforced inside func + RLS on profiles.role column via separate policy).
- Update `moderateReportAction` / `triggerIngestionAction` comments + any admin UI.
- Add E2E test: anon/auth user attempts self-promote → fails; admin can promote.
- Impact: Unblocks real mod queue for Phase 6 flagged reports + Phase 7 admin similarity tools.

**B. Real loadUserReports + Owner Report Loading — lib/data.ts + mock-data.ts + app/my-reports + consistency**
- Rename/extend: `loadUserReports()` stays mock-only for demo continuity (documented).
- New: `export async function loadUserReportsForCurrentUser(): Promise<Report[]>`
  - If !USE_REAL or no auth: delegate to mock.loadUserReports()
  - Else: Supabase query `reports WHERE user_id = auth.uid()` (RLS already allows owner even for pending/flagged) → map + sort.
- Update all call sites (mock-data internal, planner-3 consistency panel, my-reports page, getAllReports in some paths) to prefer the async owner-aware version where "my data" semantics matter.
- Add owner filter in RigConsistencyPanel "my reports only" mode.
- Parity test: in real mode, submitted report via `addUserReport` immediately appears in `loadUserReportsForCurrentUser` (optimistic or refetch).

**C. Admin Real Wiring (Minimal for Phase 6/7) — app/admin/page.tsx + data.ts + actions**
- Remove or conditionalize demoRole banner when `USE_REAL && real profile.role present`.
- Wire `getAdminOverviewStats`, moderation queue, hardware aliases (existing), and new Performance Catalog tab to real paths when flag=true + role check passes (reuse existing `moderateReportAction` pattern; add `getHardwarePerformanceCatalogAsync` etc. in data.ts).
- Keep demoRole as "simulation" toggle for !real or for admins testing UI states.
- Add protected `upsertHardwarePerformanceAction` (Phase 6/7.2) with admin role check.

**D. Observability Stubs (before any rollout)**
- Add lightweight console + optional hook points: `[similarity] catalogMiss rate`, `validationMismatch(severity, deviation)`, `similarityComputeMs`.
- Align with PHASE5_MONITORING_SETUP.md (add to Sentry breadcrumbs or Supabase logs when enabled).
- Admin tile: "Validation flags (24h)", "Avg similarity score", "Catalog coverage % on recent reports".

**E. Feature Flag Hygiene**
- Introduce `NEXT_PUBLIC_HARDWARE_SIMILARITY_ENABLED` (default true after 7.1 land; documented in .env.example + README).
- Dark launch helper in engine: always compute legacy + new score; log diff when both enabled (dev only or sampling).
- All new UI surfaces gated by the flag (or the catalog presence).

These remediations are **owned by Phase 7 #4** because they are the integration/parity foundation. They also unblock the "real admin" that Phase 6 Planner 4 assumed was coming in "Phase 2".

---

## 7. Admin Tooling for New Similarity Features

**Phase 6 Base (from Planner 4):** New "Performance Catalog" tab (read-only MVP: version, table of entries, export JSON, stats tile). Later CRUD + protected seed action.

**Phase 7 Extensions (this planner):**
- Same tab or sibling "Similarity Insights" (or unified "Hardware Intelligence"):
  - Catalog coverage % on recent approved reports (query + engine classify unknown vs known).
  - Top mismatch clusters (high deviation reports that passed validation — possible OC / FG signals for curators).
  - Rig archetype distribution (buckets from Planner #1 §4): "Flagship 4K: 142 reports, avg FPS 98 on Cyberpunk-like titles".
  - Similarity engine version + last catalog version used.
  - Quick "Recompute all moderatorNotes with current catalog" (background-safe, admin only; appends audit note).
- Bulk tools reuse existing `admin-bulk-import-dialog.tsx` pattern + new JSON schema for catalog overrides + similarity config (tolerances, weights).
- Moderation queue enhancements (already in Planner 4): richer validation context + new "Similarity context" (closest community match score at submit time if logged).
- Role-gated: Curator (new lightweight role? or reuse moderator) sees read-only analytics; admin sees edit + bulk.

**Real-mode path:** All via new protected Server Actions (role check mirroring moderate/ingest) + RLS on `hardware_performance` (public read) + future audit log table.

**Demo parity:** Full mock admin extensions in `lib/mock-data.ts` (load/save catalog overrides in LS, synthetic mismatch stats).

---

## 8. Feature Flag & Responsible Rollout Strategy (Learning from Reviewer 3 Criticism)

**Criticism Synthesis (from plan language + code gaps):** Reviewer 3 (Rollout/Security/Observability) repeatedly stresses: "flag discipline", "no bypass", "order (validation after rate/dup)", "RLS", "rollback", "observability before flip", "risks of early enablement". Phase 6 plans already call for dark launch, canary, PHASE5 checklist + swarm sign-off gate. This plan hardens it for similarity.

**Recommended Flag Model (additive to existing `NEXT_PUBLIC_USE_REAL_DATA`):**
- `NEXT_PUBLIC_HARDWARE_VALIDATION_ENABLED` (Phase 6, default true post-land).
- `NEXT_PUBLIC_HARDWARE_SIMILARITY_ENABLED` (Phase 7, default true post-7.1; controls new engine + surfaces).
- Dark launch (internal, no UI change): Engine always runs both legacy + perf-aware; telemetry only (sampling 10%).
- Soft launch (per-surface): Enable richer badges/distributions on CompatibilityChecker + one game page first (behind the flag + optional query param or cookie for canary cohort).
- Full: Remove legacy calls; old calculateSimilarity remains as compat shim.
- Catalog version pinning: All results carry `catalogVersion` + `similarityEngineVersion`; UI shows "powered by catalog 2026.05.26-v1". Updates are atomic (bump version + deploy).

**Rollout Phases (modeled on PHASE5_ROLLBACK_PLAN + Planner 4 §8):**
1. **Pre-Flip Remediation + Verification (this plan):** RLS fix, loadUserReports real, admin skeleton, parity matrix script green, unit + e2e green on seeded DB.
2. **Dark (staging + prod, 1-2 weeks):** Compute + log only. Monitor fallback rates, compute times, catalog miss % via new admin tile + logs.
3. **Soft / Canary (feature-flagged cohort or specific games, 1 week):** New surfaces visible to 5-10% or opt-in testers. A/B both scores in UI (subtle). Full swarm + gallery + aggregate report using updated prompts.
4. **Full (prod flag true):** After sign-off (4 specialist reviewers + aggregate + updated PHASE5 checklist delta + on-call approval). Update README + "What's new".
5. **Rollback:** Instant env var flip of similarity flag (or full USE_REAL in emergency). Zero data loss. Rehearse in staging. Primary escape hatch per PHASE5_ROLLBACK_PLAN.

**Observability Requirements (pre any canary):**
- Log sampling for similarity compute (duration, #reports scored, avg score, fallback count, catalogVersion).
- Validation mismatch volume + severity distribution (ties to Phase 6).
- Fallback rate to legacy scorer.
- Admin-visible dashboard tiles (mismatch rate, coverage, top unknown hardware).

**Security / Bypass Prevention (explicit per Reviewer 3):**
- Similarity never bypasses RLS (always post-fetch approved reports via adapter).
- No client-only "trust me" paths for admin similarity tools.
- Validation remains server-authoritative (Phase 6).
- Self-escalation fixed before any real admin surfaces for similarity.

**Learning Applied:** Explicit "no early flip" gates, documented rollback rehearsal, telemetry before user-visible change, swarm using structured format with P0 security/flag items.

---

## 9. Documentation & Contributor Updates

**Required Updates (non-blocking for MVP but before full rollout):**
- **README.md:** New "Hardware Validation & Community Similarity" section (high-level + links to "How we validate" + "How we match similar hardware" + catalog sourcing attribution + "contributing hardware data" guide).
- **plans/**: This document + any deltas to Phase 6 MASTER/Planners. Update VERIFICATION_SWARM_PROMPTS.md with Phase 7 reviewer prompts (copy structure from existing 6).
- **PHASE5_PRODUCTION_READINESS_CHECKLIST.md** (and future PHASE6/7 equivalent): Add 20+ items for catalog seeding, validation wiring, similarity engine, parity matrix execution, RLS/profile fix, loadUserReports real path, admin real wiring, flag rollout checklist, swarm sign-off.
- **PHASE5_ROLLBACK_PLAN.md / PHASE5_MONITORING_SETUP.md:** Extend with similarity-specific rollback triggers (high mismatch false-positive rate, similarity score discontinuity after catalog bump) and monitoring queries.
- **lib/hardware-performance-catalog.ts header (Phase 6 deliverable):** Full sourcing + "How to propose updates" + note on similarity engine consumers.
- **New education component (synergy Planner 3 + #2):** `HowWeMatchSimilarHardwareInfo.tsx` (or extend existing) with perfIndex explanation, tolerances, "why not just series?", catalog version, "your data improves the catalog" CTA. Surface in checker, game pages, consistency panel, submit footer, admin.
- **Contributor docs:** "Extending the Performance Catalog" (PassMark/TPU snapshot process, JSON export/import roundtrip, version bump rules) + "Adding a new similarity factor" (pure fn contract, parity test requirement).
- **Changelog / release notes:** Per surface (ReportCard richer badge, etc.).
- **Code comments:** JSDoc on every new pure fn referencing the planner sections + "parity invariant".

All docs must call out the 100% parity guarantee and the remediation work done in §6.

---

## 10. Risks, Mitigations, and Sign-off Gates

**Top Risks (realistic given current state):**
- Phase 6 never lands cleanly → Phase 7 blocked or forced to duplicate catalog logic (mitigation: this plan owns gate + remediation as P0).
- RLS bypass exploited before fix → privilege escalation in admin (mitigation: P0 SQL + test + no real admin surfaces until fixed).
- loadUserReports gap causes "my reports" to be empty or stale in real mode → broken consistency panel + user trust loss (mitigation: implement + parity test before any UI using it).
- Flag flip before swarm/observability → undetected regressions in similarity quality or perf (mitigation: explicit gates + dark launch).
- Catalog staleness + similarity drift after hardware launches → bad matches (mitigation: version pinning, education, curator JSON import path, quarterly refresh process documented).
- Worktree (or branch) divergence during Phase 7 parallel work → merge hell (mitigation: plan-as-contract + sequential preference for integration-heavy #4 work).

**Sign-off Gates (modeled on Planner 4 + VERIFICATION_SWARM):**
- Remediation complete + matrix script green on both mock/real.
- Phase 6 catalog + validation + basic admin tab landed + reviewed.
- Phase 7 #1 engine + #2 surfaces code complete + unit/integration green.
- Full 4+ reviewer swarm (updated prompts) + aggregate report + gallery + updated PHASE* checklist.
- On-call + security review of RLS fix + flag plan.
- Dark launch metrics acceptable (1 week+).
- Soft canary + user feedback window.
- Final flag true only with documented rollback rehearsal.

---

## 11. Exact Files & High-Level Changes Owned by This Planner (Phase 7 #4)

**New (or major):**
- `plans/phase7-planner-4-integration-parity-rollout-plan.md` (this document)
- `scripts/test-parity-matrix.ts` (full 2x2x2 harness + assertions)
- `scripts/test-similarity-engine.ts` (pure fn + bench)
- Extensions to `scripts/phase5-e2e-real-data.ts` (`testHardwareSimilarityAndParity`)
- `lib/data.ts`: real `loadUserReportsForCurrentUser` (and any other missing branches), new similar* async wrappers + re-exports, observability hooks
- `supabase/schema.sql`: RLS policy fix for profiles (role protection)
- `app/admin/page.tsx`: Real wiring skeleton + new "Similarity Insights" section + role-aware banner
- `app/actions/reports.ts`: Optional `getHardwarePerformanceCatalog` or upsert action (protected); any moderatorNotes enrichment helpers
- `components/admin-performance-catalog-tab.tsx` (or inline) + new sibling similarity analytics component
- Updates to `VERIFICATION_SWARM_PROMPTS.md`, `PHASE5_PRODUCTION_READINESS_CHECKLIST.md`, `README.md`, education components (cross-ref Planner 3 #2)

**Modified (additive):**
- `lib/mock-data.ts`: Mock implementations for new admin similarity stats + catalog overrides; owner report sync helpers
- `lib/types.ts`: Any missing types for distribution/percentile (coordinate with #1)
- Existing admin/mod queue for richer similarity context display
- All call sites of loadUserReports → evaluate for owner-aware version

**No breaking changes** to public APIs or existing ReportCard/checker flows.

---

## 12. References (Absolute Paths from Inspection)

**Phase 6 Plans (authoritative spec):**
- `C:\Users\taken\grokbuild\plans\MASTER-Hardware-Validation-Implementation-Plan.md`
- `C:\Users\taken\grokbuild\plans\planner-1-hardware-catalog-plan.md`
- `C:\Users\taken\grokbuild\plans\planner-2-validation-submit-flow-plan.md`
- `C:\Users\taken\grokbuild\plans\planner-3-ux-my-rig-consistency-plan.md`
- `C:\Users\taken\grokbuild\plans\planner-4-admin-rollout-testing-plan.md`

**Existing Phase 7 Plans (coordination):**
- `C:\Users\taken\grokbuild\plans\phase7-planner-1-similarity-engine-plan.md`
- `C:\Users\taken\grokbuild\plans\phase7-planner-2-ui-surfaces-plan.md`

**Current Code State (gaps identified):**
- `C:\Users\taken\grokbuild\lib\data.ts:40` (USE_REAL), `658-660` (loadUserReports unconditional mock), `688-707` (load/saveMyRig warnings)
- `C:\Users\taken\grokbuild\lib\mock-data.ts:351` (LS impl), `573-642` (old calculateSimilarity/predict)
- `C:\Users\taken\grokbuild\supabase\schema.sql:231-232` (profiles RLS ALL), `289-311` (mod policies relying on role)
- `C:\Users\taken\grokbuild\app\admin\page.tsx:463-473` (demo banner), `70-111` (demoRole)
- `C:\Users\taken\grokbuild\app\actions\reports.ts:185-226` (moderate role check, good), `66-151` (submit order)
- `C:\Users\taken\grokbuild\app\my-reports\page.tsx`, `components\rig-consistency-panel.tsx` (future, referenced in plans)

**Verification & Rollout Culture:**
- `C:\Users\taken\grokbuild\VERIFICATION_SWARM_PROMPTS.md`
- `C:\Users\taken\grokbuild\PHASE5_PRODUCTION_READINESS_CHECKLIST.md`
- `C:\Users\taken\grokbuild\PHASE5_ROLLBACK_PLAN.md`
- `C:\Users\taken\grokbuild\PHASE5_MONITORING_SETUP.md`
- `C:\Users\taken\grokbuild\FINAL_AGGREGATE_VERIFICATION_REPORT.md`
- `C:\Users\taken\grokbuild\scripts\phase5-e2e-real-data.ts`

**Other:** `lib/types.ts`, `components/report-card.tsx:23`, `components/compatibility-checker.tsx`, `app/games/[slug]/page.tsx`, `app/profile/page.tsx`, etc.

---

**This plan is realistic, defensive, and directly actionable.** It does not overstate the readiness of prior work. It owns the hard integration and safety problems (RLS, adapter completeness, flag discipline, worktree hygiene) that previous phases left open, while providing a clear path for the delightful community similarity features to ship on a solid, parity-guaranteed foundation.

**Ready for review + coordination with Phase 7 Planners #1 and #2 + user approval to proceed (remediation + Phase 6 execution first).**

— Phase 7 Planning Agent #4 (Integration, Parity, Testing, Admin & Rollout)
