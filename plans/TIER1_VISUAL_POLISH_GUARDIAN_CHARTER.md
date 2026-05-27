# TIER 1 VISUAL POLISH SWARM
## Guardian Charter & Evidence Requirements
**Agent 3 — Visible Results & Consistency Guardian**

**Status:** Phase A Foundational Deliverable (Locked Authority Document)  
**Authority:** Veto power on all visual language changes for the swarm. Centralized Style Change Controller for globals.css and hard-coded color sites.  
**Date:** 2026-05-26  
**Purpose:** Define non-negotiable visible results evidence, establish "No New Visual Language" guardrails, and control the Phase A → Phase B gate.

---

## 1. Core Mandate

This swarm exists to deliver **high craft visual polish** to the existing RunDB product while preserving its established ProtonDB-inspired, data-dense, community-tool personality 100%.

- **Goal:** Make the product feel "richer, more refined, more deliberate" — never "redesigned" or "modernized."
- **Absolute Constraint:** No new visual language. All changes must be deeper, more consistent, or more polished *executions* of the language already present in the codebase (globals.css + ReportCard + GameCard + tier system + subtle interaction patterns).
- **Guardian Role:** Agent 3 is the final arbiter. Proposals are accepted only when they demonstrably improve craft *within* the existing personality. The Guardian may veto at any time.

This document is the single source of truth for what "success" looks like visually and what evidence must be produced.

---

## 2. The 7 Sacred Visual Language Candidates

These seven elements constitute the protected core of the product's visual personality. Any proposal that alters, competes with, or dilutes any of these triggers immediate Guardian review and likely veto.

1. **ReportCard DNA (The Heart of the Product)**  
   Exact information hierarchy, density, and scannability in <2 seconds. Hardware row (icons + GPU/CPU/RAM), hero FPS numbers (large mono tabular), notes/tweaks snippet, similarity badge (emerald treatment), footer (time + helpful heart + "Details" accordion), expanded details panel (`bg-muted/40`). Used in full, compact, and owner-gated modes. This is non-negotiable.

2. **GameCard Portrait Treatment**  
   Consistent 2/3 aspect-ratio cover treatment with subtle bottom gradient overlay, dominant tier PerformanceBadge + reports count pill positioned on the image, optional attribution micro-text, hover scale on image (existing 1.03), footer with title/year/developer + genre chips + avg FPS data. Graceful real-cover + fallback behavior that preserves visual weight.

3. **Performance Tier Visual System**  
   The five exact tiers (Excellent / Good / Playable / Struggling / Unplayable) with their specific color + background + border treatments defined exclusively in `app/globals.css` (`--tier-*` vars and `.badge-*` classes). Sizing variants (sm/md/lg) via `PerformanceBadge` component. Placement semantics on covers and cards. No new tier aesthetics or color inventions.

4. **Card Surface Language**  
   Rounded-2xl cards on `bg-card` with `border-border` base. Hover language: `translateY(-1px)`, specific border lighten (`#475569` range), subtle box-shadow lift. `.report-card` and `.card` transition patterns (0.08s–0.1s ease). No new shadow vocabulary, no glassmorphism, no heavy elevation.

5. **Data Typography & Numerics**  
   - `tabular-nums` everywhere for FPS, counts, RAM.
   - `font-mono` + large sizing for hero FPS values (3xl/4xl).
   - Icon + text pairs with precise spacing and muted-foreground labels.
   - Strict hierarchy: hero numbers > primary labels > secondary metadata.
   - Geist font family with existing tracking/leading.

6. **Theme Token System & Globals.css Authority**  
   Deep navy/black ProtonDB palette (`--background: #0a0f1c`, `--card: #111827`, etc.). All colors flow through CSS variables in `app/globals.css` or approved Tailwind semantic tokens. Centralized control. Hard-coded hex/rgb only in tightly scoped, pre-existing patterns (e.g. dialog surface) and subject to migration pressure toward vars. No new color sites without Guardian approval.

7. **Subtle Depth & Polish Layer**  
   Existing gradient language (cover fades, fallback gradients, `bg-gradient-to-t from-black/80`), backdrop-blur on pills/overlays, focus-visible rings reusing `--ring`, loading skeleton patterns that exactly mimic final card density and layout. Micro-interaction timing (sub-300ms subtle transforms). Footer and header treatment. No new decorative motifs.

**Rule:** If a proposed change cannot be described as "a higher-craft execution of one or more of the above seven," it is out of scope.

---

## 3. Mandatory Evidence Checklist — Visible Results Requirements

Every phase (starting with Phase A proposals) **must** produce documented before/after evidence on the following surfaces and states. Textual annotations + high-quality screenshots are required. "It looks better" is not sufficient; evidence must map explicitly to the 7 Sacred Candidates.

### Primary Required Surfaces (Minimum for Phase A Lock)

**A. Home Page Trending Grid** (`app/page.tsx`)
- Full 6-column (xl) grid of GameCards with real/mature stats.
- Required states: 
  - Default loaded view.
  - Loading skeleton state (dense mimic of final cards).
  - Partial error state.
  - Hover on multiple cards.
  - At least one cover error fallback.
- Focus: Density preservation, badge/pill legibility and contrast, cover treatment consistency, grid rhythm.
- Evidence artifacts: `home-trending-grid-before.png`, `home-trending-grid-after.png` + annotation.

**B. Reports List / Browser** (`app/reports/page.tsx`)
- Visual grouped banner rows (the current beautiful banner treatment, not old table).
- Required states:
  - Multiple filter combinations showing dominant tier badges + large mono avg FPS.
  - Banner covers (with/without attribution).
  - Loading skeleton rows that mimic final banner anatomy.
  - Empty state.
- Focus: Banner visual weight, typography hierarchy on metrics, integration of PerformanceBadge, row hover.
- Evidence artifacts: `reports-browser-banners-before.png`, `reports-browser-banners-after.png`.

**C. Game Detail — Reports Section** (`app/games/[slug]/page.tsx`)
- Dense vertical stack of ReportCards (primary view of the heart component).
- Required states (multiple cards in context):
  - Default scannable view.
  - At least one card with "Details" accordion expanded (showing tweaks/driver/issues treatment).
  - Cards showing active similarity badge (emerald "X% match to your rig").
  - Voted state on helpful heart.
  - Active filter chips visible above the list.
- Evidence artifacts: `game-detail-reports-dense-before.png`, `game-detail-reports-dense-after.png`.

**D. One Dialog — SubmitReportDialog** (`components/submit-report-dialog.tsx`)
- Open dialog in representative filled + empty states.
- Required states:
  - Default form.
  - Validation errors visible.
  - Submitting (disabled) state.
- Focus: Form field density and spacing against the custom dark dialog surface (`!bg-[#111827] border-[#334155]`), button treatment consistency, label/input contrast, overall dialog chrome fidelity to the rest of the app.
- Evidence artifacts: `submit-dialog-open-before.png`, `submit-dialog-open-after.png`.

**E. Representative GameCard (Isolated Anatomy)**
- Full visual breakdown of a single GameCard.
- States: Default, hover, cover error fallback.
- Must clearly show all overlays, gradient, badge, pill, footer hierarchy.
- Evidence: `gamecard-anatomy-before.png` / `after.png` + callouts.

**F. Representative ReportCard (Isolated + States)**
- Single ReportCard in multiple relevant states (can be composited).
- States: Base, expanded details, similarity active, compact mode (as used in checker), voted.
- Must demonstrate <2s scannability remains intact or improved.
- Evidence: `reportcard-states-before.png` / `after.png` with annotations.

### Secondary Required Surfaces (Must Also Be Shown in Evidence Pack)

- All five PerformanceBadge tiers (Excellent/Good/Playable/Struggling/Unplayable) at sm/md/lg sizes, in situ and isolated.
- Embedded CompatibilityChecker (home + game detail) showing compact ReportCard usage and overall integration.
- SiteHeader + global footer in page context (nav, MyRigIndicator, AuthButton, buttons).
- Loading skeleton patterns across at least two primary surfaces.
- Mobile/responsive views (≤768px) on home trending grid + one dense ReportCard list (graceful stacking, no breakage of density or hierarchy).
- At least one view from `/games` list page (GameCard grid with filters).

**Screenshot Protocol (Mandatory):**
- Consistent desktop viewport (1440px–1920px primary).
- Tablet breakpoint (768px) for responsive evidence.
- Dark theme only.
- High-fidelity data (real or seeded mock that matches production density).
- File naming convention: `{surface}-{state}-before|after.png`.
- Every screenshot must be accompanied by a short markdown note explaining:
  1. Which Sacred Candidate(s) are being exercised.
  2. Specific craft improvement demonstrated.
  3. Confirmation that no new visual language was introduced.

**Evidence Location (to be created/maintained by swarm):**
`docs/evidence/phase-a/baseline/` and `docs/evidence/phase-a/after/` (or equivalent under plans/evidence if preferred by team).

---

## 4. Pass / Fail Criteria — "Richer but Still the Same Product"

### Clear Pass Criteria
- The change measurably improves legibility, contrast, scannability, micro-delight, or perceived quality.
- Information hierarchy, density, and visual weight are preserved or enhanced.
- All colors, radii, transitions, shadows, and typography derive from or directly extend the existing 7 Sacred Candidates and globals.css tokens.
- The result can honestly be described as "the same ProtonDB-style data-dense community tool, only executed with noticeably higher craft."
- Evidence pack demonstrates the improvement against baseline.

### Clear Fail Criteria (Requires Revision)
- Any reduction in information density or increase in perceived whitespace/airiness.
- New visual motifs, metaphors, or treatments (glass, heavy/new gradients, colored accents outside the tier system, different card shapes, new icon language).
- Structural rearrangement of ReportCard or GameCard that changes scan path or relocates primary data.
- Typography or numeric hierarchy drift.
- Introduction of competing "variants" or "new components" instead of refining existing patterns.

### Veto Triggers (Immediate Guardian Rejection — Non-Negotiable)
1. Any diff touching `app/globals.css` (new vars, modifications to `.report-card`, `.badge-*`, tier colors, transitions, scrollbars, toasts, etc.) without prior explicit Guardian pre-approval.
2. Introduction of new hard-coded color literals (hex, rgb, hsl) outside the five tier pairs and the small number of pre-existing scoped exceptions (dialog surface, specific gradients). Even scoped exceptions require justification and eventual migration plan.
3. Any redesign, re-architecture, or major layout change to ReportCard (the heart) or GameCard.
4. Deviation from established border-radius vocabulary (`rounded-2xl`, `var(--radius)` family, existing small values) or introduction of new pill/rounded-full treatments without precedent.
5. New motion, animation, or transition language whose timing or character deviates from the existing subtle 0.08s–0.3s ease family.
6. Any proposal language or framing that implies "new design," "modernization," "ProtonDB 2.0," or similar. Only language of refinement and craft within the established personality is acceptable.
7. Changes that shift the product feel away from functional community data tools (ProtonDB / PCPartPicker / HowLongToBeat) toward consumer/marketing/product polish.
8. Bypassing the centralized style authority (hard-coded styles in TSX/JSX that duplicate or contradict globals.css for colors, borders, or surfaces).
9. Any evidence that fails to map proposed changes explicitly back to one or more of the 7 Sacred Candidates.

**Note on Later Role:** As Centralized Style Change Controller, Agent 3 must be tagged on *every* future PR or proposal that touches globals.css or introduces color sites. No exceptions.

---

## 5. Phase A Review & Lock Process

This process enforces the gate between research/proposal work and implementation.

**Step 1: Baseline Capture (Immediate post-charter)**
- Guardian or designated agent captures pristine baseline screenshots of all checklist items above before any proposals are executed. These become the immutable reference.

**Step 2: Agent 1 Deliverable (Visual Audit & Baseline Mapping)**
- Exhaustive audit of current state against the 7 Sacred Candidates.
- Full inventory of every hard-coded color, non-standard radius, and deviation from globals.css.
- Mapping of every visual surface to the evidence checklist.
- Delivered to Agent 3 (Guardian) for review.

**Step 3: Agent 2 Deliverable (Scoped Polish Proposals)**
- Concrete, minimal, scoped proposals for each surface in the evidence checklist.
- Every proposal **must**:
  - Name the exact Sacred Candidate(s) being refined.
  - Provide before/after textual justification tied to craft improvement.
  - Avoid scope creep.
- Proposals that cannot pass the veto triggers above are pre-rejected.

**Step 4: Guardian Review Gate (Agent 3)**
- Agent 3 reviews both outputs against this charter within one cycle.
- Produces a signed "Phase A Lock Report" (either as update to this document or a companion `PHASE_A_LOCKED_PROPOSALS.md`).
- For each proposal: **Accept** / **Accept with Conditions** / **Reject with Citation** (specific criteria or veto trigger).
- If any proposal introduces new visual language, formal veto is issued with clear reasoning.
- Only the Guardian-approved, locked subset of proposals may be handed to Phase B builders.

**Step 5: Explicit Clearance Signal**
- Guardian publishes the final locked charter version + accepted proposals list + baseline evidence pack + "Evidence Capture Protocol for Phase B."
- Only after an explicit statement ("Phase A Locked — Phase B Cleared to Proceed") are Phase B agents permitted to begin implementation.
- Any work begun before this signal is at risk of rejection.

**Step 6: Ongoing Enforcement**
- Guardian retains absolute veto authority throughout the swarm.
- All globals.css or color-site changes require Guardian review + documented approval comment before merge.
- Any discovered drift during implementation triggers immediate stop + remediation against the locked baseline.

---

## 6. Success Definition for the Swarm

The swarm succeeds when:
- Every mandatory evidence surface has high-quality before/after documentation that clearly demonstrates richer craft.
- All changes are traceable to refinement of the 7 Sacred Candidates.
- A neutral observer familiar with the original product would describe the result as "the same excellent data-dense RunDB, but noticeably more polished and deliberate."
- No new visual language was introduced at any layer (CSS, components, layout, interaction).
- The Guardian has signed off on the final evidence pack.

Anything short of this standard fails the charter.

---

## 7. References & Baseline Sources

- `app/globals.css` — Single source of truth for theme, tiers, report-card rules, scrollbars, toasts.
- `components/report-card.tsx` — Heart of the product.
- `components/game-card.tsx` — Portrait cover language.
- `components/performance-badge.tsx` + globals tier classes.
- `components/submit-report-dialog.tsx` — Representative dialog.
- `app/page.tsx`, `app/games/[slug]/page.tsx`, `app/reports/page.tsx`, `app/games/page.tsx` — Primary surfaces.
- `README.md` (Design Notes section) and `VERIFICATION_SWARM_PROMPTS.md` (Prompt 4 & 6) — Prior articulation of ProtonDB dense personality.
- All existing `.report-card`, `.badge-*`, `tabular-nums`, and hover patterns in the codebase.

---

**Guardian Signature (Agent 3)**  
This charter is now in force. All subsequent Phase A outputs will be reviewed strictly against it.

**End of Document**

*Any questions about interpretation must be resolved by the Guardian before proceeding. Veto authority is absolute for visual language integrity.*