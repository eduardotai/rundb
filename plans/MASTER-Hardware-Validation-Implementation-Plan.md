# MASTER: Hardware Performance Validation Implementation Plan (Synthesized from 4 Specialized Planners)

**Project:** RunDB / grokbuild — Hardware-Aware Performance Plausibility for User-Submitted Game Reports + Rig Consistency  
**Date:** 2026-05-26  
**Status:** Planning complete. 4 specialized planner agents produced coordinated, high-detail plans. This document unifies them for execution.

**Core User Requirement (verbatim):**  
"When the user (logged in or anonymously) add their setup info into the site, all the games reports and all the performances that other players have submitted match (or very closely) the inputted hardware."

In practice: When hardware is declared (My Rig / profile / submit form) or reports are submitted with hardware + FPS claims, the system validates that the claimed performance is plausible for that hardware using a curated real-world performance catalog. Mismatches produce educational client warnings, server-side `status='flagged'` + rich moderator notes, or hard blocks on absurd claims. Works 100% identically for anonymous (Supabase anon + localStorage guests) and authenticated users.

---

## 1. Executive Summary & Key Decisions (Unified)

All 4 planners are in **strong agreement** on architecture, phasing, and invariants. No material conflicts.

**Primary Architecture (from Planner 1, confirmed by 2-4):**
- **Static curated TypeScript catalog** (`lib/hardware-performance-catalog.ts`) as the source of truth for hot paths (submit validation, rig health, consistency scans). O(1) pure functions, zero runtime dependencies, works offline/anonymous.
- Relative `perfIndex` (GPU/CPU normalized ~100 for flagships, derived from public PassMark G3D + CPU Mark + TPU cross-refs, with clear attribution).
- Wide statistical tolerance bands (initially ~0.43×–2.28× expected, wider for unknown hardware) to accommodate OC, DLSS+Frame Gen, capture variance, driver tricks, laptop power limits, etc. — non-punitive by design.
- `validateHardwarePerformance(...)` → `HardwareValidationResult` with `severity: 'ok' | 'warn' | 'block'`, `expectedRange`, `reason`, `canonicalGpu/Cpu`, `catalogVersion`.
- Server (`submitReportAction`) is the authoritative enforcer. Client warnings are UX only.

**Phasing (unified from all planners):**
- **MVP / Phase 1 (immediate value, low risk):** Static catalog + normalization + pure validation functions + seeded data (50-80 GPUs + 30+ CPUs). Client warning banner + educational accordion in submit dialog. Server block/warn+`flagged`+rich `moderatorNotes` in `submitReportAction`. Basic read-only "Performance Catalog" admin tab + version display. Minor prediction improvement. Full anon/auth parity. Dark launch option (log only).
- **Phase 2:** `hardware_performance` table (DDL from Planner 1) + seed script + real-mode admin CRUD + enhanced moderation filters + full Rig Consistency Panel + My Reports hardware match badges + retro "validate my reports" for users. Bulk mod tools.
- **Phase 3 (optional):** Curator refresh pipeline (local only), per-game baselines table, advanced admin analytics.

**Core Invariants (repeated across all 4 plans):**
- Additive defense-in-depth (validation runs *after* existing rate-limit + duplicate checks).
- FPS-only tier calculation unchanged.
- Non-accusatory, educational language everywhere ("This may reflect... wide tolerance applied").
- 100% parity for anonymous/guest (localStorage + pure static logic) and logged-in (DB + same pure logic).
- Static catalog for hot paths (speed + offline + parity); DB only for admin overrides/audit later.
- Existing design system, Sonner toasts, ReportCard patterns, RLS, moderation flow, and data adapter (`USE_REAL`) reused without breakage.

**Files Overview (consolidated):**
- **New core (Phase 1):** `lib/hardware-performance-catalog.ts`, `lib/normalize-hardware.ts` (or co-located), `plans/` docs.
- **Modified (Phase 1):** `lib/types.ts`, `app/actions/reports.ts`, `components/submit-report-dialog.tsx`, `app/admin/page.tsx` (new tab), `lib/data.ts` (re-exports).
- **Phase 2+:** DB migration (`supabase/schema.sql`), admin enhancements, new small components per Planner 3 (`ValidationWarningBanner`, `RigHealthCard`, `HardwareMatchBadge`, `RigConsistencyPanel`, `PlausibilityIndicator`, `HowWeValidateInfo`), test files, docs.
- Total new + changed files: ~18-22 (very manageable for 4 parallel implementers using worktrees).

---

## 2. Unified 3-Phase Execution Roadmap

**Phase 1 — Foundation & Enforcement (MVP, ~1-2 weeks target)**
- Planner 1 catalog + types + normalization + seeding (first 20-30 entries sufficient for launch).
- Planner 2: Full wiring into `submitReportAction` (post anti-abuse) + dialog client pre-check + rich warning UI (banner + accordion with "why this might happen").
- Planner 3: Basic submit UX complete + initial education footer note + toast patterns.
- Planner 4: Read-only admin catalog viewer tab + version + export. Basic mismatch logging. Rollout checklist (dark → soft → full).
- Testing: Unit for pure validation (10+ scenarios from Planner 2), submit E2E in mock + real modes.
- Deliverable: Working end-to-end on new submissions (warnings + flags/blocks). Historical reports untouched.

**Phase 2 — Polish, Admin Power, User Tools (~2-4 weeks)**
- DB table + seed + real admin CRUD (JSON import for curators).
- Full Planner 3 UX: Rig health on save (both editors), Rig Consistency Panel (scan user's reports vs current rig, outlier list), My Reports hardware match badges + details, ReportCard owner-gated plausibility, global "How we validate" info surface.
- Moderation enhancements (Planner 4): severity/catalog/hardware filters, quick override, bulk actions, rich validation details in queue.
- Enhanced monitoring tile in admin.
- Expanded tests + visual checks.

**Phase 3 — Maturity (future)**
- Optional external data refresh process (local curator only).
- Per-game baselines from approved reports.
- Public read-only catalog API exposure.
- Advanced anomaly detection.

---

## 3. Recommended 4-Implementation-Agent Split (from Planner 4, refined)

Use **isolated git worktrees** (`isolation: "worktree"`) for safe parallel work with zero merge conflicts during development.

**Implementer A — Catalog & Core Data Layer (highest priority, unblocks everyone)**
- `lib/hardware-performance-catalog.ts` (full seeded data + all pure functions + `validateHardwarePerformance` + factors + templates).
- `lib/normalize-hardware.ts` (or internal).
- `lib/types.ts` additions.
- `lib/data.ts` re-exports + wrappers.
- Initial seed data (20-40 entries) + header with sourcing.
- Unit tests for pure functions.

**Implementer B — Submit Hot Path + Client Validation UX**
- `app/actions/reports.ts` (validation call after dup check, status/notes mutation, block error messages).
- `components/submit-report-dialog.tsx` (full rich warning banner + educational accordion per Planner 3 wireframe, state machine, "Submit anyway"/edit flows, footer note).
- Minor `lib/toast.ts` enhancements if needed.
- Ensure graceful unknown-hardware handling.

**Implementer C — Admin, Moderation, Real Adapter, DB Migration**
- `app/admin/page.tsx` (new Performance Catalog tab + viewer + stats + export; later CRUD).
- `supabase/schema.sql` addition (hardware_performance table + RLS + indexes).
- `lib/mock-data.ts` admin extensions (mock catalog CRUD for demo parity).
- `lib/data.ts` async admin catalog paths.
- Protected seed action (modeled on `triggerIngestionAction`).
- Moderation queue filter + detail enhancements.
- Real-mode wiring for catalog (static primary + future DB merge).

**Implementer D — My Rig Consistency, My Reports, Education, Polish, Docs, Testing Matrix**
- All Planner 3 components: `RigHealthCard`, `RigConsistencyPanel`, `HardwareMatchBadge`, `PlausibilityIndicator`, `HowWeValidateInfo`, `ValidationWarningBanner` (extracted).
- Updates to `profile-rig-editor.tsx`, `compatibility-checker.tsx`, `app/my-reports/page.tsx`, `app/games/[slug]/page.tsx`, `components/report-card.tsx`.
- Full documentation (README, contributor catalog update guide, PHASE5_* updates).
- Expanded E2E + parity matrix tests.
- Monitoring/observability stubs.

**Execution Order Recommendation:** A first (or A+B in parallel once catalog API is stable), then B+C+D. Use worktrees.

---

## 4. 4-Reviewer Split (per user request + Planner 4)

After implementation PRs land (or in parallel on worktrees):
- **Reviewer 1:** Admin + Moderation UI + queue experience + role checks.
- **Reviewer 2:** Anonymous/Guest + Auth + Real/Mock parity matrix + localStorage paths + offline behavior.
- **Reviewer 3:** Rollout safety, security (bypass prevention), performance (O(1) proof), observability, rollback plan.
- **Reviewer 4:** Documentation, user education surfaces, design system consistency, non-accusatory tone, overall delight/trust.

Each reviewer produces the structured output format from `VERIFICATION_SWARM_PROMPTS.md` (findings by severity, screenshots where relevant, aggregate sign-off).

---

## 5. Key Risks & Mitigations (Unified)

- False positives on legit reports (OC, advanced upscaling tricks): Extremely wide initial bands + educational language + human mod review + "submit anyway".
- Curator burden / data staleness: Documented quarterly refresh process + admin JSON import + clear attribution in code.
- Mod queue flood on launch: Bulk tools + severity filters + dark launch phase + education.
- Community reaction: "How we validate" transparency page + non-punitive framing from day one.
- Demo vs real drift: All planners emphasize static catalog + pure functions for parity; admin mock adapters kept in sync.

---

## 6. Next Immediate Actions for Orchestrator (You)

1. Present this master plan + the 4 source plans to the user for approval.
2. Once approved, spawn the 4 implementation agents (using `spawn_subagent` with `isolation: "worktree"`, distinct worktree paths, and subagent-specific prompts that include excerpts from the relevant planner + master).
3. Monitor progress via `get_command_or_subagent_output`.
4. Once implementations stabilize, spawn the 4 reviewers (read-only mode or full review on the branch/worktree).
5. Consolidate reviewer findings, drive fixes, run full verification (extend existing PHASE5 E2E + swarm prompts), update docs.
6. Merge / promote.

---

## 7. References to Source Plans

All four source plans are in `plans/` and are the authoritative detailed specs:
- `planner-1-hardware-catalog-plan.md` — Data model, catalog, seeding, static-vs-API research (27k+ chars).
- `planner-2-validation-submit-flow-plan.md` — Exact function signatures, algorithm with constants, precise file:line diffs for action + dialog.
- `planner-3-ux-my-rig-consistency-plan.md` — Rich UX wireframes, 6 new small components, insertion points, accessibility.
- `planner-4-admin-rollout-testing-plan.md` — Admin tab details, mod enhancements, full testing matrix, 4-impl + 4-reviewer split, rollout phases, risks.

This master document is intentionally concise for decision-making. Implementers and reviewers must read the relevant source planner(s) in full.

---

**Ready for user approval to proceed to spawning the 4 implementation agents (and later 4 reviewers) using isolated worktrees.**

All 12 agents (4 planners already done + 4 impl + 4 review) will have been spawned as requested.

— Orchestrator synthesis (based on direct tool inspection of all 4 planner outputs + full codebase review)