# Hardware Validation Planner Agent #4: Admin Tooling, Moderation Workflow, Rollout, Testing, Anonymous Parity & Production Readiness Plan

**Focus:** Production Shipping, Admin Extensions, Moderation Enhancements, Testing Matrix, Anonymous/Guest Parity, Scalability, Security, Monitoring, Migration, Documentation & Handoff  
**Date:** 2026-05-26  
**Context:** Complements and aligns 1:1 with:
- `plans/planner-1-hardware-catalog-plan.md` (static `lib/hardware-performance-catalog.ts`, `HardwarePerfEntry`, `GPU_CATALOG`/`CPU_CATALOG`, `perfIndex`, `validateHardwarePerformance`, `HardwareValidationResult`, `CATALOG_VERSION`, wide tolerance bands, `severity: 'ok' | 'warn' | 'block'`, `expectedRange`/`deviationRatio`, `canonicalGpu`/`canonicalCpu`, `reason`, `hardware_performance` table DDL + public RLS, seeding from PassMark/TPU, basic admin viewer).
- `plans/planner-2-validation-submit-flow-plan.md` (pure function wiring into `submitReportAction` *after* dup checks + client pre-check in `submit-report-dialog.tsx`, rich non-accusatory `moderatorNotes` on warn, server `block` Error, 1% low rules, unknown hardware graceful degradation, server as final arbiter).
- `plans/planner-3-ux-my-rig-consistency-plan.md` (rich amber banners + accordion in dialog, RigHealthCard, HardwareMatchBadge, PlausibilityIndicator on owner-gated ReportCard, RigConsistencyPanel, HowWeValidateInfo education, full anon + real/mock parity via data adapter + pure fns).

This is the **"how do we ship this safely, maintain it at scale, and verify everything"** document. All terminology, shapes, phases (MVP/Phase 2/Phase 3), and invariants (static catalog for parity, defense-in-depth after rate/dup, non-accusatory tone, `NEXT_PUBLIC_USE_REAL_DATA` flag discipline) are coordinated exactly with Planners 1-3.

**Core Invariants (enforced in this plan):**
- Validation is additive defense-in-depth (never replaces rate/dup/RLS/moderation).
- 100% identical experience/enforcement for authenticated (incl. Supabase anonymous users via `user_rigs`/`profiles`), guests (localStorage only via `'rundb_my_rig'` + `'rundb_user_reports'`), and real vs mock modes.
- Server (`submitReportAction` + future RPC) is authoritative; client is UX only.
- Reuse existing admin patterns, data adapter (`lib/data.ts`), RLS, and PHASE 5 verification culture 100%.
- No retroactive changes to historical reports.

---

## 1. Executive Summary & Mandatory Alignment Notes

**Goal:** Ship hardware plausibility validation safely with production-grade admin tooling, moderation enhancements, comprehensive testing, observability, and zero-regression parity. Aligned rollout uses the exact 3-phase structure from Planner 1, the verification/swarm/rollback discipline from existing `PHASE5_*` + `VERIFICATION_SWARM_PROMPTS.md`, and the feature-flag + adapter patterns proven in `lib/data.ts`.

**Key Findings from Deep Codebase Inspection (2026-05-26):**
- **No validation code exists yet** (grep for `HardwareValidationResult|validateHardwarePerformance|hardware-performance-catalog|HardwarePerfEntry|perfIndex|catalogVersion` returns matches *only* in the three planner .md files). Current `submitReportAction` (app/actions/reports.ts:66-151) and `submit-report-dialog.tsx` have zero hardware checks. `moderatorNotes` and `status='flagged'` already exist and are rendered.
- **Admin surface** (`app/admin/page.tsx`, 1016 lines): 5 tabs (`reports`/`games`/`hardware`/`images`/`overview`). Reports queue (lines 508-626) filters `['all','pending','approved','rejected','flagged']`, renders moderatorNotes inline under status badge (line 573: `{r.moderatorNotes && <div className="mt-1 text-[10px]...">{r.moderatorNotes}</div>}`), quick actions + Notes dialog (lines 309-330, 991-1012). Hardware Aliases tab (lines 759-809) has full CRUD (add/edit/delete via `get/add/update/deleteHardwareAlias`). Stats tiles (lines 476-495) include `hardwareAliases`. Demo role switcher persisted in `localStorage.getItem('rundb_demo_role')`. Bulk import dialog (lines 887-950) for CSV/JSON. Protected `triggerIngestionAction` (admin role only).
- **Actions** (`app/actions/reports.ts`): `submitReportAction` does auth/game lookup → rate (5/hr) + exact 24h dup (auth only, lines 86-113) → insert (status defaults 'pending', no moderator_notes). `moderateReportAction` (lines 185-226): auth + `profiles.role IN ('moderator','admin')` check (lines 198-206) → updates status/moderated_by/at/moderator_notes. `triggerIngestionAction` enforces admin role.
- **Mock admin layer** (`lib/mock-data.ts` ~745-978): `getModerationQueue` (751), `updateReportStatus` (764, LS `loadModerationOverrides` + sync to user_reports), `getHardwareAliases`/`add`/`update`/`delete` (795-844), `getAdminOverviewStats` (964), `bulkImportGames`/`parseCSV`. Always pure LS.
- **Adapter** (`lib/data.ts`): `USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'` (line 40). Admin tools (855-909) *always* delegate to mock (no real branch yet — noted as demo limitation in admin banner line 468-472). Other paths (reports, myRig, submit) branch correctly with safe fallbacks.
- **Schema** (`supabase/schema.sql`, 427 lines): `report_status` ENUM includes `'flagged'`. `reports` has `status`, `moderator_notes text`, `moderated_by/at`. `hardware_aliases` table (Phase 4). **No `hardware_performance` table yet** (Planner 1 §6 DDL ready: PK `canonical`, `component_type`, `perf_index`, indexes on vendor/type, `ALTER ... ENABLE ROW LEVEL SECURITY`, public SELECT policy). Moderator RLS policies (lines 289-311): EXISTS on `profiles.role IN ('moderator','admin')` for SELECT/UPDATE all reports. Public: only approved readable. Insert: owner or anon.
- **Supabase clients**: `lib/supabase/server.ts` uses anon key + cookies (RLS enforced server-side); service_role only in scripts/ingest.
- **Verification culture** (strong, production-grade):
  - `PHASE5_PRODUCTION_READINESS_CHECKLIST.md`: 100+ item checklist (feature flag discipline, RLS, real vs mock, admin foundations Phase 4, E2E via `scripts/phase5-e2e-real-data.ts`, rollback via flag flip, canary, Sentry).
  - `VERIFICATION_SWARM_PROMPTS.md`: 6-agent independent swarm process with *exact structured output format* (Executive Summary, Master Plan Alignment table, Detailed Findings with `file:line`, Gaps, Risks, Recommendations P0/P1/P2, Evidence snippets, Confidence). Roles include Schema, Security/RLS, Performance, etc.
  - `PHASE5_ROLLBACK_PLAN.md` + `PHASE5_MONITORING_SETUP.md`: Primary rollback = flip `NEXT_PUBLIC_USE_REAL_DATA=false` (<2 min, zero data loss). Monitoring emphasis on fallbacks, errors, mod queue health.
  - `scripts/phase5-e2e-real-data.ts`: Existing real-mode E2E harness (exercises submit, RLS, media).
  - **No src unit tests** (`__tests__`, jest, playwright, vitest absent from app/ lib/ components/ except node_modules/docs). Testing is manual + E2E script + swarm reviews. `package.json` has no `test` script (only dev/build/lint/ingest:games).
- **Real/mock flag usage**: Centralized, safe fallbacks everywhere except current admin tools (always demo). Submit dialog shows mode note (line 249). Perfect foundation for validation parity matrix.
- **Alignment perfect**: Planners 1-3 terminology, order (validation *after* rate/dup in action), anon parity via static pure fns + adapter, non-accusatory language, wide bands, catalog version in results/notes, "Submit anyway" for warn, education surfaces. Planner 4 extends these without breakage.

**Risk Posture**: Low if phased + reuse patterns. Highest risks (false flags on mod queue, curator load, community reaction) mitigated by Planner 1 wide tolerances + Planner 3 education + this plan's bulk tools + monitoring.

---

## 2. Admin UI Extensions: New "Performance Catalog" Tab

**Reuse existing patterns 100%** (tabs, tables, dialogs, refreshKey/useMemo, role guards, bulk import dialog, stats tiles, protected actions). No new UI primitives.

### Phase 1 (MVP — read-only viewer + version + export)
- Add after "Hardware Aliases" tab in `TabsList` (app/admin/page.tsx ~499-505) and new `TabsContent value="performance"`.
- Header: "Performance Catalog (catalog v{CATALOG_VERSION})" + "Read-only (Phase 1). Curated from PassMark/TPU (see file header). Export for curator updates."
- Stats tile addition: "Catalog Entries" (GPU + CPU count from imported catalog).
- Table (reuse `<Table>` + existing styling): columns Canonical | Type (GPU/CPU) | Perf Index | Vendor | Series | Min RAM Rec | Last Updated | Notes (truncated).
- Filters: search (canonical/vendor/series), vendor pills (NVIDIA/AMD/Intel), series dropdown (reuse alias search pattern).
- Buttons:
  - "Export JSON" (download full seeded catalog + version; mirrors bulk import file handling).
  - "Copy Version" (clipboard).
  - "View Source Notes" (small dialog with Planner 1 §4 sourcing block).
- Read-only: no edits. "Propose Update" button opens simple textarea for curator JSON patch (saved locally or copied for PR).
- Implementation: import `{ CATALOG_VERSION, GPU_CATALOG, CPU_CATALOG } from '@/lib/hardware-performance-catalog'` (or via re-export in `lib/data.ts`). Flatten into array for table. Use `useMemo` + refreshKey.
- File: either inline in `app/admin/page.tsx` (like current hardware tab) or new `components/admin-performance-catalog-tab.tsx` (preferred for cleanliness; pass demoRole/canAdmin).

**Exact insertion sketch** (after Hardware Aliases trigger in TabsList):
```tsx
<TabsTrigger value="performance">Performance Catalog</TabsTrigger>
```
New content reuses `getAdminOverviewStats` pattern for entry counts.

### Phase 2 (Full CRUD + JSON import for curators)
- Add editable table or dialog (reuse alias dialog pattern lines 953-988).
- Bulk "Import JSON overrides" (reuse bulk import dialog + `bulkImportGames`/`parseCSV` patterns; validates against `HardwarePerfEntry` shape).
- In real mode: writes to `hardware_performance` table via new protected Server Action (e.g. `upsertHardwarePerformanceAction` in `app/actions/reports.ts`, admin role check like `triggerIngestionAction` lines 268-277).
- Audit: every change appends to notes or new `report_validation_logs` (future per Planner 1).
- DB seed script: extend `scripts/` (protected).

**Stats & Overview tab updates**: Add catalog coverage % + mismatch rate tile (see Monitoring §9).

**Handoff note**: New tab must appear *after* Hardware Aliases in tab order for logical "normalization → performance" flow.

---

## 3. Moderation Queue Enhancements

**Current rendering** (app/admin/page.tsx:554-619): Table with Game | Hardware (gpu+cpu+ram) | FPS | Tier (PerformanceBadge) | Status (Badge + optional moderatorNotes div line 573) | Date | Actions (quick Approve/Reject/Flag + Notes button). Filters include 'flagged'. 50-row cap with note.

**Enhancements (build on existing, zero breakage)**:
- **Surface validation details**: Parse `moderatorNotes` (starts with "AUTO: Hardware perf validation warn (catalog 2026.05.26-v1): ..."). Display richer:
  - In table row: small badge "Hardware Warn (vX)" (amber) next to status if reason contains "Hardware perf".
  - Expandable (reuse ReportCard accordion/Chevron pattern or new `<details>`): full `reason`, `expectedRange {min-max}`, `deviationRatio`, `canonicalGpu/Cpu`, `severity`.
  - In Notes dialog: pre-populate or show "Validation context" section (read-only for mods).
- **New filters** (add state like `reportFilter`):
  - Severity pills: All / OK (hidden) / Warn / Block (derived from notes or future structured column).
  - Catalog version dropdown (parse unique versions from notes).
  - Hardware series filter (text or pills: "RTX 40", "RDNA3", "Zen 4" — derived via simple extract or reuse `extractGpuSeries` from mock-data).
  - "Validation Flagged Only" quick toggle.
- **Quick "override to approved" with audit**:
  - New green "Approve + Clear Validation" button (for flagged rows with validation notes).
  - On click: calls `updateReportStatus` (or `moderateReportAction` in future real) with status='approved' + appended note: `Original validation: ${oldNotes}. Manually reviewed & approved by ${user} at ${iso}.`
  - Preserves history.
- **Bulk actions** (new toolbar when >=1 selected, reuse table patterns):
  - Multi-select checkboxes (add to TableRow).
  - "Bulk Approve (incl. validation-flagged)", "Bulk Reject", "Bulk Add Note".
  - Confirmation modal (list affected + impact on stats).
  - Server-side in real mode: loop `moderateReportAction` or new batch RPC (future).
- **"View Full Validation"** action opens dedicated lightweight dialog (or reuses Notes) showing structured `HardwareValidationResult` (recompute client-side if needed using current catalog for consistency).
- **Real mode path**: Extend `lib/data.ts` admin exports with real equivalents (use `getReportByIdForMod` + new queries + `moderateReportAction`). Keep demo role until full profiles.role + middleware.

**Flagged reports from validation flow in cleanly** (no breakage):
- `submitReportAction` (post-P2) sets `status='flagged'`, `moderator_notes = "AUTO: Hardware perf validation warn (catalog ${v.catalogVersion}): ${v.reason}..."`.
- Queue already filters 'flagged' and renders notes (line 573). New enhancements simply make the AUTO notes more prominent/actionable.
- Mock path (demo): `updateReportStatus` already syncs status/notes to user_reports.
- Real path: `moderateReportAction` + RLS moderator policy already handle.

---

## 4. Anonymous + Guest User Parity Guarantees (100% Identical)

**Requirement from all three planners**: "Works identically for Supabase-auth users (including anonymous) and localStorage guests."

**Guarantees delivered by static catalog + adapter**:
- Pure functions (`validateHardwarePerformance`, `getCanonicalHardware`, `estimateExpectedFps`) in `lib/hardware-performance-catalog.ts` have **zero side effects, zero network, zero auth** — identical on client (dialog pre-check, rig health, consistency scans, ReportCard owner indicators) and server (action).
- Data adapter (`lib/data.ts`): `addUserReport` / `loadUserReports` / `saveMyRigAsync` etc. already branch on `USE_REAL` with safe LS fallbacks. Validation calls go through the same wrappers.
- **Guest (LS only)**: `'rundb_my_rig'`, `'rundb_user_reports'` + mock admin overrides. Full submit pre-warn banner (P3 §2), rig health post-save (P3 §3), consistency panel (P3 §7), my-reports match badges (P3 §4), owner plausibility on ReportCard (P3 §5).
- **Anon Supabase auth**: Same UI surfaces + server validation + `user_rigs` persistence + RLS-approved reads. moderatorNotes visible to owner/mods.
- **Auth users**: Identical + `profiles` + full mod queue visibility.
- **Surfaces requiring explicit parity tests** (see §6 matrix):
  - Submit dialog (pre-validation + banner + "submit anyway" → flagged + notes).
  - Profile-rig-editor + compatibility-checker save → RigHealthCard + CTA.
  - My Reports (when implemented) hardware match column.
  - Game page ReportCard (owner-gated plausibility).
  - RigConsistencyPanel scans.
  - Admin catalog viewer (read-only, same data).
  - Moderation (flagged reports appear with full details for mods only).

**Enforcement**: All new code imports from catalog (or re-export via `lib/data.ts`). No direct LS or DB perf logic. "Guest mode — data stored only in this browser" disclaimers (P3) preserved.

---

## 5. Real vs Mock Data Mode Testing Matrix

Every path exercised in **both** `NEXT_PUBLIC_USE_REAL_DATA=false` (LS + mock admin) **and** `=true` (Supabase + RLS + real actions), for guest + anon + full auth.

| Path | Mock (flag=false) | Real (flag=true) + Guest/Anon/Auth | Notes |
|------|-------------------|------------------------------------|-------|
| Client pre-submit validation (dialog) | Pure fn, amber banner, forceSubmit | Identical + server defense | Anon LS vs user_rigs |
| Server block (absurd) | N/A (client catches); mock addUserReport | submitReportAction throws → dialog showUserError | Rate/dup still first |
| Server warn → flagged + rich moderatorNotes | Local status/notes | DB insert with status/notes; visible in real mod queue | RLS mod policy |
| Admin catalog tab (read-only/Phase2 CRUD) | LS/static data | Same static + future DB overrides | Role guard (demo vs profiles.role) |
| Mod queue view + moderatorNotes render | LS overrides | Real queries via moderate/getReportByIdForMod | Extend data adapter |
| Quick approve / Notes dialog / bulk | Mock updateReportStatus | moderateReportAction (role check) | Audit notes preserved |
| Rig save → health card + consistency scan | LS rig + loadUserReports | user_rigs + real reports | Pure fn recompute |
| ReportCard plausibility (owner) | LS ownership heuristic | report.userId === auth.uid() | Gated |
| 1% low + unknown hardware edge cases | All pure | All pure + server | Same results |
| Export/Import catalog JSON | Local | Same + real upsert action | Curator workflow |

**Test execution**: Extend `scripts/phase5-e2e-real-data.ts` (TEST_RUN_WRITE=true) + new manual matrix in docs. Fallback simulation (kill Supabase temporarily) must still show warnings + preserve UX.

---

## 6. Full Testing Strategy

**Unit (pure catalog functions — add immediately)**:
- New: `lib/__tests__/hardware-validation.test.ts` (or inline guards).
- Use Vitest (add to devDeps + `package.json` `"test": "vitest"`).
- 10+ cases from Planner 2 §10 exactly (flagship OK, mid insane BLOCK, unknown lenient, 1% low invalid, suspiciously perfect 1% low, legit FG tolerance, etc.).
- Also test `getCanonicalHardware`, factor application, reason templates, confidence calc.
- Run in CI on every PR.

**Integration**:
- Submit end-to-end in both modes: plausible → pending/approved path; borderline → warn banner + "anyway" → flagged + notes visible in admin; absurd → block error.
- Rig save + consistency scan (mock + real).
- Alias + catalog canonical synergy (when aliases loaded).

**E2E**:
- Extend existing `scripts/phase5-e2e-real-data.ts` (testGameMediaAndImageAssertions etc.): new `testHardwareValidationRealData` (submit known good/bad via browser, assert toasts/banners, admin login as mod, assert flagged notes + quick approve).
- Playwright (recommended; add config) or puppeteer for dialog + server block + admin review flows.
- Mobile + a11y (keyboard on banners/accordions, aria roles per P3 §9).

**Visual Regression**:
- New banners (amber validation warning with accordion), badges (HardwareMatchBadge, PlausibilityIndicator, severity pills), catalog table rows.
- Use existing screenshot tooling or Percy/Chromatic if added; manual + Chromatic-lite for PRs.

**Other**:
- Real-data mode smoke: `NEXT_PUBLIC_USE_REAL_DATA=true npm run build && ...` (per PHASE5 checklist).
- Fallback paths explicit.
- Performance: catalog lookup <1ms (benchmark in test).
- Update `PHASE5_PRODUCTION_READINESS_CHECKLIST.md` with validation section.

**Package changes**: Add test script + vitest (or jest). No new heavy deps.

---

## 7. Rollout Plan (Aligned Exactly to Planner 1 3 Phases + PHASE5 Discipline)

**Shared mechanism**: `NEXT_PUBLIC_USE_REAL_DATA` flag + data adapter (primary). Optional dedicated `NEXT_PUBLIC_HARDWARE_VALIDATION_ENABLED` (default true after MVP) for finer control. Dark launch via env in staging only.

### MVP / Immediate (Post catalog + submit wiring + basic admin viewer — "Week 1")
- Client warnings + server enforcement (block/warn+flag+notes) live.
- Basic read-only Performance Catalog tab + version + export.
- Prediction similarity bonus (Planner 1 §7).
- Full parity + unit tests passing.
- **Dark launch mode** (log-only internally, behind extra env or commented): validation runs + logs results/mismatch rate but never sets 'flagged' or shows UI. Toggle to soft via deploy.
- Deploy behind existing flag=false. Internal canary with =true.
- Update PHASE5 checklist + README.

### Phase 2 (2-3 weeks later — DB + enhanced admin + monitoring)
- `hardware_performance` table + seed script (protected admin action).
- Full admin CRUD + JSON import for curators (real writes).
- Enhanced mod queue (structured validation surfacing, filters, bulk).
- Mismatch rate stats tile + simple admin "dashboard" section.
- Real moderation queue adapter branch (use `moderateReportAction` + queries).
- Tune constants from initial flagged data (wide bands preserved).
- Soft launch: client warnings prominent + education (P3 surfaces); server flags active.
- Full E2E + swarm review pass.

### Phase 3 (later, optional)
- Per-game baselines table.
- External refresh pipeline (local curator only).
- Advanced outlier detection.
- Public catalog read API (rate-limited).

**Rollback (per PHASE5_ROLLBACK_PLAN.md)**: Flip validation-related env (or full USE_REAL) → validation no-op. Safe (additive). Rehearse in staging.

**Canary/Gradual**: 5% traffic → 25% → 100% with 24-48h stable + zero fallback spikes + mod queue review.

---

## 8. Monitoring / Observability

- **Admin stats extension** (immediate): New tile "Validation Mismatch Rate" (% of recent submits that were warn/block). Filterable by catalog version/hardware series.
- **Simple dashboard** (Phase 2 admin overview): Table or cards of recent validation outcomes (parsed from moderatorNotes or new lightweight `report_validation_logs` table). Trend chart (client-side or Supabase view).
- **Logging**: In `submitReportAction` (post-validation): `console.log('[validation]', { catalogVersion, severity, gameId, deviationRatio, canonicals })`. Tag with real vs mock.
- **Alerting (lightweight first)**:
  - Sudden spike in 'flagged' (e.g. >15% in 1h) → Slack/ Sentry alert (possible new hardware launch or factor bug).
  - High "unknown hardware" rate → curator notification.
  - Fallback warnings in data adapter > threshold.
- **Sentry** (per PHASE5): Tag validation errors. Error boundaries around submit/banner.
- **Supabase logs**: Watch slow queries on reports (none expected).
- **Community signals**: Monitor Discord/feedback for "flagged" complaints (tie to education rollout).

**Metrics to track**: % warn (target <8% after tuning), % block (<0.5%), mod override rate on validation-flagged (high override = too strict), catalog coverage % of recent submissions.

---

## 9. Migration & Backfill

- **Historical/seed reports**: **Do not retro-validate**. Existing data (pre-catalog) remains untouched (status as-is). Only *new* submissions after deploy run validation.
- Optional: One-time curator pass in /admin to review old high-FPS outliers manually (using new catalog viewer for reference).
- **hardware_performance table (Phase 2)**: Idempotent upsert seed script (run once via protected admin action or CLI). Static TS remains source-of-truth for hot path; DB for overrides/audit only (DB wins on canonical conflict).
- No schema change for MVP (moderator_notes sufficient per P2 §11).
- Future: `report_validation_logs` audit table (optional Phase 3).

---

## 10. Performance & Scalability

- **Catalog (MVP)**: Pure TS `Record<string, HardwarePerfEntry>` maps. O(1) lookup for canonical + perf. Zero DB, zero network in submit/validation hot paths. Works offline/anon. Proven negligible (map access << any DB roundtrip).
- **DB table (Phase 2+)**: Small (hundreds of rows max). PK on canonical. Indexes per Planner 1: `idx_hardware_perf_vendor`, `idx_hardware_perf_type`. RLS: public SELECT (like games table). Writes: admin-only via Server Action (role check + rate limit). Query volume: only admin catalog viewer + (future) curator tools. No impact on report queries or user submit.
- **Overall**: Validation adds <5ms server CPU (pure fn). Mod queue filters remain efficient (existing indexes on status + created_at).
- **Scale**: 10k+ reports: moderatorNotes text search acceptable for MVP; later full-text or structured JSONB column + GIN index.
- **Proof in tests**: Add micro-benchmark asserting catalog lookup <1ms for 1000 calls.

---

## 11. Security / Abuse Hardening

- **Defense-in-depth order** (enforced in code per P2 §4.1): 1. Rate limit + dup (existing) → 2. Hardware validation (new) → 3. Tier/insert.
- **No client bypass**: Server action always runs full `validate...` (even if client forces "anyway" or direct fetch to action). Block throws before any DB work.
- **RLS unchanged**: Validation never touches DB in hot path. Flagged reports still subject to existing moderator RLS policies (profiles.role check).
- **Role hardening**: All admin catalog writes / bulk import / mod actions use same pattern as `moderateReportAction` + `triggerIngestionAction` (auth.getUser + profiles.role query).
- **Rate limiting still first**: Validation cannot be used as DoS (rate gate precedes it).
- **No new secrets**: Catalog static. No external calls.
- **Abuse vectors mitigated**: Absurd claims now hard-blocked or auto-flagged for human review (rich context for mods). Complements (does not replace) existing dup/rate.
- **Anon parity**: Lighter protection for anon (as today) but validation still runs identically.

---

## 12. Documentation Updates

- **README.md**: Add "Hardware Validation" section (high-level + link to "How we validate" + catalog sourcing). Note feature flag + parity guarantees.
- **PHASE5_PRODUCTION_READINESS_CHECKLIST.md**: New section "Hardware Validation (Planners 1-4)" with items for catalog seeding, submit wiring, admin tab, mod enhancements, parity matrix, unit/E2E, mismatch monitoring, rollout phases. Reference this plan.
- **PHASE5_ROLLBACK_PLAN.md** + **MONITORING**: Add validation-specific triggers (spike in blocks/flags, catalog version mismatch).
- **Contributor guide** (new or in catalog file header + README): "Updating the Catalog" — extract from public mega pages (5-10 min), PR with version bump + notes, admin export/import flow (Phase 2).
- **User-facing education** (synergize P3): Expand `components/how-we-validate-info.tsx` / dedicated section or `/about/validation`. Include exact factors, tolerance philosophy, "wide bands for real variance (OC/DLSS+FG/laptop/1% low)", catalog sources, "flags → human moderator with full context", link to source notes.
- **Admin docs** (in overview tab or separate): Role simulation → real profiles.role migration notes; how to use new Performance Catalog tab + propose updates; bulk mod for validation flags.
- **JSDoc / code comments**: Update submitReportAction, data adapter, admin page with cross-refs to Planners 1-4.
- **VERIFICATION_SWARM_PROMPTS.md**: Add new reviewer role "Hardware Validation Rollout Auditor" (or extend existing) for future PRs.

---

## 13. Risks Specific to Rollout & Mitigations

1. **Mod queue overload from initial false flags** (most likely on launch): Wide bands (0.43x–2.28x+ per P1/P2) + unknown-hardware leniency + education reduce volume. **Mitigation**: Bulk approve tools (§3), "Approve + Clear Validation" quick action, curator pre-review of seeded data, mismatch dashboard for early tuning. Target <8% warn rate.
2. **Curator burden / staleness** (new HW launches): Manual extraction. **Mitigation**: Documented 5-10min process + admin export/JSON import (Phase 2) + community PRs + "Propose update" in admin. Version in every UI note.
3. **Community reaction ("your FPS claim was flagged")**: Perceived as accusatory. **Mitigation**: Strict non-accusatory language everywhere (P2 §6 templates + P3 philosophy), rich "why this might happen" accordion (OC/FG/DLSS/laptop/patches/capture/1% low), "Submit anyway" always available, prominent education surfaces, positive reinforcement for good data. Mods see full context + override easily.
4. **Model inaccuracy on edge rigs** (CPU bottleneck low-res, heavy RT, specific engines): **Mitigation**: Very wide initial bands + game difficulty factors + RAM floor + 1% low rules + "catalog miss" grace. Future per-game baselines (P3).
5. **Admin demo vs real drift**: Current admin always mock. **Mitigation**: Explicit Phase 2 adapter branch + real role enforcement in this plan.
6. **Performance surprise on large history** (consistency scans): **Mitigation**: Client pure fns (instant), limit to last 50 reports (P3 §7).
7. **Data issues post-seed** (wrong perfIndex): **Mitigation**: Versioned + auditable in git + admin viewer + mismatch monitoring + easy rollback of catalog version.

**Overall residual risk**: Low with phased approach + existing rollback + swarm verification.

---

## 14. Exact Handoff Checklist for the 4 Implementation Agents + 4 Reviewers

**Process**: Follow `VERIFICATION_SWARM_PROMPTS.md` lightweight swarm model. 4 impl agents work in parallel (no cross-talk after kickoff). Then 4 independent reviewers (using structured output format) + Agent 4 (this plan) as orchestrator aggregates.

### 4 Implementation Agents (assigned by user)
1. **Agent A: Catalog Core + Types + Normalization** (Planner 1 primary)
   - [ ] Read all 4 planner docs + this plan + inspect `lib/types.ts`, `lib/data.ts`, `supabase/schema.sql`, `app/actions/reports.ts`.
   - [ ] Create `lib/hardware-performance-catalog.ts` (full seeded 65+ GPU / 35+ CPU, constants, pure fns including `validateHardwarePerformance`, reason builder, `CATALOG_VERSION`).
   - [ ] Add types to `lib/types.ts` (HardwarePerfEntry, HardwareValidationResult, RigHealthResult, RigConsistencyResult etc.).
   - [ ] Optional `lib/normalize-hardware.ts`.
   - [ ] Re-export via `lib/data.ts`.
   - [ ] Unit tests skeleton + 5 core cases.
   - [ ] Update catalog file header with sourcing + update process.

2. **Agent B: Submit Flow Wiring + Client UX** (Planner 2 + P3 §2 primary)
   - [ ] Wire server validation in `app/actions/reports.ts` (exact location after dup ~line 113, status/notes mutation, buildBlockErrorMessage).
   - [ ] Wire client pre-check + full rich amber banner (accordion, Edit/Submit anyway per P3 §2) in `components/submit-report-dialog.tsx`.
   - [ ] Handle resetValidation on all close/reset paths.
   - [ ] Footer note + mode display.
   - [ ] Pass-through to existing `addUserReport` / success.
   - [ ] E2E manual verification (good/warn/block in both modes).

3. **Agent C: Admin + Moderation Enhancements + Real Adapter** (this plan primary)
   - [ ] Add Performance Catalog tab (read-only MVP) to `app/admin/page.tsx` (reuse patterns exactly).
   - [ ] Enhance mod queue: validation surfacing, new filters (severity/version/series), quick override, bulk actions.
   - [ ] Extend `lib/data.ts` admin exports for real mode (queries + `moderateReportAction`).
   - [ ] Phase 2 prep: `hardware_performance` table DDL application + seed script + protected upsert action in reports.ts.
   - [ ] Stats tile + mismatch rate.
   - [ ] Role guard + demo notes preserved.

4. **Agent D: Testing, Parity, Docs, Monitoring, Rollout Hooks** (this plan + PHASE5)
   - [ ] Full unit test suite (10+ cases) + vitest setup + `package.json` test script.
   - [ ] Extend `scripts/phase5-e2e-real-data.ts` with validation E2E (dialog, server, admin review, real mode).
   - [ ] Visual regression notes + a11y for banners/badges.
   - [ ] Full real/mock + anon/guest parity matrix (documented + executed).
   - [ ] Update all docs (README, PHASE5 checklist, catalog header, education component).
   - [ ] Add mismatch monitoring + admin dashboard skeleton.
   - [ ] Rollout runbook entries + canary checklist.

### 4 Reviewers (independent, structured output per VERIFICATION_SWARM_PROMPTS.md)
1. **Reviewer 1: Admin/Mod + Catalog UI Auditor** — Focus: tab correctness, mod queue enhancements, role/RLS, reuse of patterns, moderatorNotes surfacing.
2. **Reviewer 2: Parity + Real/Mock + Testing Matrix Auditor** — Focus: identical behavior across guest/anon/auth + flag=false/true; matrix coverage; fallback safety; E2E extensions.
3. **Reviewer 3: Rollout/Security/Observability Auditor** — Focus: phased plan + PHASE5 alignment, flag discipline, rollback, monitoring/alerts, security (order, no bypass, RLS), risks.
4. **Reviewer 4: Docs + Education + Scalability Auditor** — Focus: all doc updates, user education synergy with P3, contributor catalog guide, perf/scalability claims (O(1) proof), migration/backfill.

**Kickoff artifacts for all**: This plan + prior 3 planners + full read of inspected files (admin/page.tsx, actions/reports.ts, mock-data.ts key sections, schema.sql, data.ts, types.ts, PHASE5_* + VERIFICATION_SWARM_PROMPTS.md, scripts/phase5-e2e-real-data.ts).

**Sign-off gate**: All 4 reviewer reports + aggregate (modeled on FINAL_AGGREGATE_VERIFICATION_REPORT.md) + updated PHASE5 checklist before any prod flag flip or catalog deploy.

---

## Appendix: Key Evidence Snippets from Inspected Files (2026-05-26)

**Admin mod notes render** (app/admin/page.tsx:573):
```tsx
{r.moderatorNotes && <div className="mt-1 text-[10px] text-muted-foreground line-clamp-1">{r.moderatorNotes}</div>}
```

**Action anti-abuse + insert order** (app/actions/reports.ts:86-113 then 115-150): rate/dup then insert (no validation yet).

**Mock mod queue** (lib/mock-data.ts:751-762, 764-791): filter + sort pending-first; LS overrides + user report sync.

**USE_REAL** (lib/data.ts:40): `const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'`

**Moderator RLS** (supabase/schema.sql:289-311): EXISTS profiles.role check for SELECT/UPDATE all.

**ReportStatus** (lib/types.ts:13): `'pending' | 'approved' | 'rejected' | 'flagged'`

**Schema report fields** (supabase/schema.sql:92-96): status default pending, moderator_notes text.

(Full files at absolute paths listed in References.)

---

## References (Absolute Paths)

- Plans: `C:\Users\taken\grokbuild\plans\planner-1-hardware-catalog-plan.md`, `planner-2-validation-submit-flow-plan.md`, `planner-3-ux-my-rig-consistency-plan.md`
- Core inspected: `C:\Users\taken\grokbuild\app\admin\page.tsx` (full 1016 LOC), `C:\Users\taken\grokbuild\app\actions\reports.ts`, `C:\Users\taken\grokbuild\lib\mock-data.ts` (admin sections 745-978), `C:\Users\taken\grokbuild\lib\data.ts`, `C:\Users\taken\grokbuild\lib\types.ts`, `C:\Users\taken\grokbuild\supabase\schema.sql` (full), `C:\Users\taken\grokbuild\lib\supabase\server.ts`, `C:\Users\taken\grokbuild\lib\supabase\client.ts`
- Verification: `C:\Users\taken\grokbuild\PHASE5_PRODUCTION_READINESS_CHECKLIST.md`, `C:\Users\taken\grokbuild\VERIFICATION_SWARM_PROMPTS.md`, `C:\Users\taken\grokbuild\PHASE5_ROLLBACK_PLAN.md`, `C:\Users\taken\grokbuild\PHASE5_MONITORING_SETUP.md`, `C:\Users\taken\grokbuild\scripts\phase5-e2e-real-data.ts`
- Other: `C:\Users\taken\grokbuild\package.json`, `C:\Users\taken\grokbuild\README.md`, `C:\Users\taken\grokbuild\app\games\[slug]\page.tsx`, `C:\Users\taken\grokbuild\components\submit-report-dialog.tsx`, `C:\Users\taken\grokbuild\components\report-card.tsx` etc.

---

**This plan is complete, checklist-heavy, production-grade, and directly actionable.** Implementation can proceed with the 4 agents using the handoff above. It preserves every invariant from Planners 1-3 and the existing PHASE 5 verification/rollback culture while delivering the missing admin, moderation, testing, and safe-shipping layers for hardware validation.

**Next step for the team**: Read this plan + the three prior planners in full. Assign the 4 impl agents + schedule the 4 reviewers. Begin with catalog (Agent A) + submit wiring (Agent B) in parallel.

— Hardware Validation Planner Agent #4 (Admin, Moderation, Rollout, Scalability, Testing, Anonymous Parity & Production Readiness Focus)