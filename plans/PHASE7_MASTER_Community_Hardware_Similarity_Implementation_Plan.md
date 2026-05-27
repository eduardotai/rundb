# PHASE 7 MASTER IMPLEMENTATION PLAN
## Community Hardware Similarity Engine

**Date:** 2026-05-26  
**Status:** Planning Complete. Execution begins immediately.  
**Goal:** Deliver the missing core capability the user originally requested — when a user (logged in or anonymous) declares their hardware setup, the system intelligently matches it against real reports from other players with the same or very similar hardware, surfacing meaningful performance comparisons, distributions, percentiles, and outliers.

This is the "positive mirror" to Phase 6's plausibility validation. Phase 6 tells users "this FPS claim is unrealistic for your hardware." Phase 7 tells them "here is how you actually perform compared to people with hardware like yours."

---

## 1. Current Actual State Assessment (Honest)

**Critical Reality Check (verified via direct inspection):**
- **Phase 6 implementation does not exist in main.** All Phase 6 deliverables (hardware-performance-catalog.ts, validation wiring in submit, real admin catalog tab, RigConsistencyPanel, etc.) exist only as high-quality planning documents. No code from the previous 4 implementation agents has been merged into the main workspace.
- No divergent worktrees currently exist (`git worktree list` shows only main).
- Pre-existing **Critical Blockers** that make any real-data Phase 6 or Phase 7 work unsafe:
  1. RLS bypass on `profiles` table — users (including anonymous auth) can self-escalate their role to admin/moderator.
  2. `loadUserReports()` is unconditionally the mock/localStorage version. No real "my reports" path for logged-in users.
  3. Admin page is 100% demo (demoRole + explicit "no real writes" banner). Real role enforcement exists only in actions.
  4. No observability or proper feature flag discipline for new validation/similarity logic.
  5. Existing crude similarity (`calculateSimilarity`) has no integration with the planned perfIndex catalog.

**Conclusion:** We cannot responsibly build "on top of Phase 6" because Phase 6 has not landed in code. Any attempt to do so would create technical debt or broken parity.

**Decision:** Phase 7 will be executed as a **unified, realistic program** that first remediates the blockers and properly lands the Phase 6 foundation, then builds the Community Similarity Engine on top of a solid base.

---

## 2. Phased Execution Approach (Defensive & Realistic)

### Phase 7.0 – Remediation Gate (P0 – Must Complete First)
Owned primarily by integration/parity workstream (inspired by Planner 4).

**Deliverables:**
- Fix RLS policy on `profiles` to prevent self-escalation of `role`.
- Implement real `loadUserReportsForCurrentUser()` (and update all "my data" surfaces).
- Wire minimal real admin role enforcement + skeleton for Performance Catalog tab (so real data can be used safely).
- Add basic observability hooks (console + future Sentry) for validation and similarity.
- Confirm full parity matrix on existing surfaces with the fixes above.
- Create `NEXT_PUBLIC_HARDWARE_VALIDATION_ENABLED` and `NEXT_PUBLIC_HARDWARE_SIMILARITY_ENABLED` flags with proper dark-launch support.

**Exit Criteria:** Remediation swarm + parity matrix script passes on both mock and real paths. No more known critical bypasses.

### Phase 7.1 – Phase 6 Foundation Landing
Execute the original Phase 6 plan (catalog + validation + basic admin) properly on main, using the 4 coordinated Phase 6 planner documents as the immutable spec.

- Use worktree isolation for the 4 implementation agents (A=Catalog, B=Submit+Validation, C=Admin+DB, D=UX+MyRig+Docs).
- Follow the exact insertion points, function signatures, non-accusatory tone, and wide tolerance bands from the Phase 6 plans.
- Land with full verification swarm using updated prompts.

### Phase 7.2 – Community Similarity Engine (Core Technical Work)
Build the data-driven matching capability.

**Key Components (coordinated across Planners 1 & 3):**
- New `lib/hardware-similarity-engine.ts` (or co-located) with `calculateHardwareAwareSimilarity`, `findTopSimilarReports`, `getPerformanceDistributionForSimilarRigs`, `computePercentileAmongSimilar`, etc.
- Multi-factor scoring using Phase 6 `perfIndex` (GPU-dominant continuous distances + CPU/RAM/resolution context).
- Schema evolution: Denormalize `gpu_perf_index`, `cpu_perf_index`, `canonical_*`, and bucket columns on `reports` (additive, non-breaking).
- Backfill script + protected admin action.
- Candidate pruning strategy (recent + perf-bucket range) + pure JS scoring for bounded cost.
- Optional Postgres RPC for server-side top-N as later optimization.
- Caching enhancements (perf-bucket keys in RQ, server-side report list caching).
- Full integration into existing `predictForUserRig*` paths (additive, legacy preserved during transition).

### Phase 7.3 – User-Facing Surfaces
Execute the UI plan from Planner 2.

**Major Surfaces:**
- Game pages: "Reports from similar hardware" section (top N + distribution chart + percentile when rig saved).
- Compatibility Checker: Enhanced cards with perf-based similarity, distributions, richer similar reports.
- RigConsistencyPanel + RigHealthCard: Add "Community benchmarks vs similar hardware" layer.
- ReportCard: Upgraded similarity display (perf-aware % + optional hardware context).
- My Reports: Full implementation with HardwareMatchBadge + community context.
- Education: Consistent "How we match similar hardware" surfaces everywhere (references perfIndex, tolerances, catalog version).

All surfaces maintain ProtonDB-like non-accusatory, community-positive tone.

### Phase 7.4 – Admin, Observability, Admin Tooling & Rollout
- Extend the Phase 6 Performance Catalog tab with similarity analytics (coverage, mismatch clusters, archetype distributions).
- Full admin tooling for catalog management + backfill.
- Observability dashboards / tiles (mismatch rate, similarity compute p95, catalog coverage).
- Responsible feature flag rollout (dark → soft/canary → full) with explicit gates.
- Complete parity matrix + extended E2E + verification swarm using updated prompts.

### Phase 7.5 – Polish, Documentation & Production Enablement
- Final documentation (README, contributor guides for catalog + similarity factors, education components).
- Updated PHASE5_* and verification artifacts.
- Production monitoring live.
- Final sign-off swarm + flag true.

---

## 3. Execution Structure (12-Agent Pattern Repeated)

We will repeat the successful pattern the user requested:

- **4 Planning Agents** — Already completed (their plans are the source material for this Master).
- **4 Implementation Agents** — Spawned in isolated git worktrees (isolation: "worktree"). One agent per major workstream:
  - Impl A: Remediation + Phase 6 Foundation (catalog, validation, basic admin)
  - Impl B: Similarity Engine + Data Layer (Planner 1 + 3 core)
  - Impl C: UI Surfaces & Experience (Planner 2)
  - Impl D: Admin, Observability, Rollout & Integration (Planner 4)
- **4 Review Agents** — Specialized reviews (Admin/RLS, Parity/Testing, Security/Observability/Rollout, UX/Education/Docs) using the structured format from `VERIFICATION_SWARM_PROMPTS.md`.

All agents will start from the exact same clean main + this Master plan snapshot. Plans are treated as the contract.

---

## 4. Invariants (Non-Negotiable)

- 100% behavioral parity (anonymous/guest/auth × mock/real × online/offline).
- Pure functions for all scoring and catalog logic (O(1) where possible).
- Additive changes only — never break existing ReportCard, checker, or prediction flows during transition.
- Non-accusatory, educational, community-positive tone (ProtonDB-inspired).
- Static catalog remains source of truth for hot paths.
- Server is authoritative for any enforcement (validation flags, etc.).
- Wide tolerance philosophy and graceful handling of unknown hardware.
- Full RLS respect (no bypasses introduced or left unaddressed).

---

## 5. Immediate Next Actions (Execution Begins Now)

1. **Write this Master plan** to disk (this file).
2. **Spawn the 4 Phase 7 Implementation Agents** in isolated worktrees immediately.
3. Each implementation agent will receive this Master + the relevant Phase 6/7 planner documents as their immutable spec.
4. Continue driving the full cycle (monitor impl agents → spawn reviewers when ready → consolidate reviews → drive fixes → final verification swarm) without stopping until the complete, production-ready Community Hardware Similarity capability is landed on main and verified.

---

## 6. File Locations

- This Master: `plans/PHASE7_MASTER_Community_Hardware_Similarity_Implementation_Plan.md`
- Phase 6 plans (primary specs for 7.0/7.1): `plans/planner-*-*.md` and MASTER from previous phase.
- Phase 7 planner outputs:
  - `plans/phase7-planner-1-similarity-engine-plan.md`
  - `plans/phase7-planner-2-ui-surfaces-plan.md`
  - `plans/phase7-planner-3-scaling-performance-plan.md`
  - `plans/phase7-planner-4-integration-parity-rollout-plan.md`

---

**This Master plan is now the single source of truth and coordination document for Phase 7.**

Execution of the 4 Implementation Agents in isolated worktrees begins in the next step.

---

*End of Master Plan. Process continues immediately.*