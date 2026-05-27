# PHASE A REVIEW DECISION
**Tier 1 Visual Polish Swarm — Guardian Gate**

**Decision**: **ACCEPT WITH CONDITIONS**

**Issued By**: Agent 3 — Visible Results & Consistency Guardian  
**Date**: 2026-05-26  
**Charter Reference**: `plans/TIER1_VISUAL_POLISH_GUARDIAN_CHARTER.md` (the document that established the 7 Sacred Candidates, veto triggers, evidence requirements, and review process)

**Documents Reviewed (in full)**:
- `plans/color-foundations-spec.md` (Agent 1 — Color System + Foundations Lead)
- `plans/tier-1-surface-elevation-interaction-spec.md` (Agent 2 — Surface Depth & Interaction Lead)

**Clear Top-Level Decision**:
- Agent 1 (Color Foundations Spec): **ACCEPT** — No conditions. This work may proceed to implementation immediately.
- Agent 2 (Surface Elevation & Interaction Spec): **ACCEPT WITH CONDITIONS** — Significant revisions required before any Phase B builder work is authorized on surface elevation, hovers, or related changes.
- **Overall Phase A Status**: **LOCKED ONLY AFTER CONDITIONS ON AGENT 2 SPEC ARE MET**. Phase B builders are **NOT** cleared to begin work on the elevation language until a revised version of the Agent 2 spec is re-submitted to and explicitly approved by the Guardian.

---

## 1. Evaluation Methodology (Per Guardian Charter)

I evaluated both specifications using the exact criteria defined in the charter I authored:

- The **7 Sacred Visual Language Candidates**
- The absolute **"No New Visual Language"** constraint ("richer but still the same product")
- The **Mandatory Evidence Checklist** surfaces and states
- The **Pass / Fail Criteria**
- The **Veto Triggers** (9 explicit triggers)
- The required **Phase A Review & Lock Process** (including explicit clearance signal before Phase B)

All analysis below is grounded in direct comparison to the current production codebase (globals.css, report-card.tsx, game-card.tsx, performance-badge.tsx, submit-report-dialog.tsx, and all primary surfaces).

---

## 2. Agent 1 — Color Foundations Spec: **ACCEPT** (Unconditional)

### Strengths (Direct Alignment with Charter)
- This specification directly repairs and protects **Sacred Candidate #6 (Theme Token System & Globals.css Authority)** — the single most critical foundation.
- It correctly identifies the root architectural mismatch (hex strings in `:root` vs. `hsl(var(--*))` expectation in tailwind.config.ts) that was causing the entire token system to be unreliable.
- The proposed HSL conversions are mathematically precise 1:1 matches to the *existing shipping hex values*. No hue, saturation, or lightness invention.
- Scope is strictly limited to the 7 sacred candidates (globals.css + the 6 files with documented hard-coded hex bypasses). No scope creep.
- The two new variables (`--border-subtle` and `--border-strong`) are **verbatim extractions** of already-shipping hard-coded colors (`#334155`, `#475569`) that were previously scattered as bypasses. This is explicitly permitted by the charter's tie-breaker guidance for Agent 1.
- Repeated, explicit emphasis on "exact visual match", "zero new visual language", "reversible", and "No New Visual Language rule satisfied."
- Migration plan is incremental, testable, and prioritizes fixing globals.css first (correct order).
- It enables all future polish work by making the token system actually functional.

### Veto Trigger Check
- **No veto triggers hit**. This spec *eliminates* hard-coded colors rather than introducing them. It strengthens centralized authority.

### Evidence Checklist Alignment
- This work is a prerequisite for producing reliable before/after evidence on every required surface (home trending grid, ReportCard lists, SubmitReportDialog, GameCards, banner rows). It does not itself change visuals.

### Pass/Fail
- **Clear PASS**. This is higher-craft execution of the existing language by making the intended design system actually work. It is protective of everything that follows.

**Guardian Finding**: Agent 1 has produced exemplary Phase A work. Proceed to implementation on this spec without waiting for the elevation revisions below.

---

## 3. Agent 2 — Surface Elevation & Interaction Spec: **ACCEPT WITH CONDITIONS** (Requires Major Revision)

This specification was evaluated with the highest level of scrutiny because it directly touches **Sacred Candidates #1 (ReportCard DNA), #2 (GameCard), #4 (Card Surface Language), #6 (Theme Tokens), and #7 (Subtle Depth & Polish Layer)** — the heart of the product's personality.

### Positive Elements Acknowledged
- Intent is clearly aligned with "data-dense ProtonDB personality."
- Discipline around reduced-motion support, scannability claims, centralized rules in globals.css, and `data-tier` contract is good.
- Before/after descriptions reference the correct evidence checklist surfaces (home trending, game detail reports, reports banners).
- Avoidance of glassmorphism, heavy gradients, or 3D is respected.
- The spec attempts to reference the Guardian Charter's Sacred Candidates.

### Critical Failures Against the Charter

**1. Multiple Direct Veto Triggers Activated**

- **Veto Trigger #2 (New hard-coded color literals)**: The spec introduces a large number of new `rgba(...)` and some hex values that did not exist in the baseline:
  - `--rim-excellent` through `--rim-unplayable` as `rgba(34, 197, 94, 0.18)` etc. (completely new visual treatment).
  - New shadow definitions using `rgb(0 0 0 / 0.32)`, `rgba(255,255,255,0.035)`, etc.
  - New badge hover borders (`#166534`, `#1e40af`, etc.) and similarity pill `rgba(16,185,129,0.14)`.
  - Expanded details border `#334155` (new rule).
  - These are not "aliases of existing tier pairs." They are new color sites in globals.css.

- **Veto Trigger on New Motion Language**: 
  - Introduces `--transition-hover: 200ms cubic-bezier(0.23, 1, 0.32, 1)` and `--transition-image: 300ms cubic-bezier(...)`.
  - Current codebase uses simple `ease` / `0.08s–0.1s ease` / `duration-300` patterns. A custom cubic-bezier is a material deviation in motion character, not a refinement.

- **Veto Trigger on Card Surface Language (#4) Expansion**:
  - Original ReportCard/GameCard hover is deliberately minimal and documented: `translateY(-1px)`, specific border lighten to `#475569`, very light `0 4px 12px -2px rgb(0 0 0 / 0.3)`.
  - The proposal replaces this with a full new "premium elevation system" (multi-layer shadows, inset white highlights, consistent -2px lift, new tier-rim halos). This is not "deeper execution of the same subtle language" — it is the introduction of a richer, more layered elevation language.

- **Veto Trigger on ReportCard DNA (#1)**:
  - Adding new internal classes and hover treatments directly to the heart component (FPS text-shadow pop, similarity pill background shift + lift, heart scale transform, expanded-details inner shadow) constitutes structural micro-redesign of the sacred scannable unit. The charter is explicitly protective here.

**2. Violation of "No New Visual Language" & Pass/Fail Criteria**

- The "tier-tinted rim" concept (1px colored halo on hover that appears only on tier-bearing surfaces) is a **new visual metaphor**. It did not exist in the original ProtonDB-inspired implementation. Even if "restrained," introducing a new interaction cue tied to performance tier is new language.
- The overall effect (rich directional shadows + inset highlights + colored rims + internal element pops) moves the product perceptibly toward a more "premium interactive catalog" feel rather than the original calm, dense, data-tool aesthetic.
- Many new shadow tokens (`--shadow-card-hover`, `--shadow-card-hover-xl`, etc.) represent a significant expansion of the token system (Sacred #6) rather than minimal evolution.

**3. Scope & Evidence Concerns**
- While the spec claims to touch only certain Sacred Candidates, the richness of the changes effectively touches #1 (ReportCard internals) and over-extends #4 and #7.
- The proposed changes would require substantial new before/after evidence on the Mandatory Checklist surfaces. The current "before" descriptions in the spec accurately describe the *existing* subtle language; the "after" descriptions describe something noticeably different in character.

**Guardian Finding**: This proposal crosses the line from "polish within the existing language" into "introducing a more sophisticated elevation and micro-interaction language." It would require the Guardian to approve a meaningful shift in the product's personality. That is outside the charter.

---

## 4. Required Conditions for Agent 2 Spec Revision

Before the Guardian will issue "Phase A Locked — Phase B Cleared" for surface work, Agent 2 **must** produce a revised specification that satisfies **all** of the following (no partial credit):

### Mandatory Reductions (Non-Negotiable)
1. **Remove the tier-rim system entirely** (all `--rim-*` variables, all `[data-tier]:hover` rules that add colored 1px rings, all references to "tier-tinted rim"). This is new visual language.
2. **Eliminate the custom cubic-bezier transitions**. Use only the existing `ease` family or the minimal existing timing patterns already present in globals.css and component classes. No new `--transition-hover` / `--transition-image` tokens with custom curves.
3. **Dramatically reduce shadow ambition**. 
   - Keep lift at the original `-1px` (or at most a conservative `-1px` to `-1.5px` range if justified).
   - Do not introduce multi-layer "premium" shadows with specific inset white highlights as a new system.
   - Any shadow evolution must be minimal deltas on the *existing* `0 4px 12px -2px rgb(0 0 0 / 0.3)` pattern.
4. **Remove all new internal micro-interactions on ReportCard** (no text-shadow on FPS, no background or transform changes on similarity pill, no scale on heart, no new expanded-details shadow). ReportCard internals must remain untouched in this phase.
5. **No new hard-coded color literals** of any kind in the revised globals.css rules. All values must be expressed exclusively via the HSL tokens delivered by the (accepted) Agent 1 spec, or direct semantic tokens (`border-border`, `bg-muted`, etc.).
6. **Remove the new shadow token block** (or reduce it to at most 1-2 conservative extensions that are direct, minimal improvements on the single existing shadow pattern).

### Allowed (Still Requires Guardian Re-Review)
- Minor, conservative improvements to existing hover patterns (e.g., slightly more consistent border lighten or a single small shadow delta) **only if** they can be described as "making the current subtle language more reliable and consistent across surfaces."
- Centralization of existing hover strings into globals.css (good hygiene).
- Consistent application of `data-tier` attributes where already appropriate for future-proofing (without the rim behavior).
- Work that makes the existing subtle hovers apply more uniformly to GameCards, banner rows, and stats cards without changing their character.

### Required Additions to Revised Spec
- Explicit mapping of every proposed change back to the exact original CSS rules it is replacing (with line numbers).
- Confirmation that all changes remain within the original "subtle 0.08s–0.3s ease" character described in the Guardian Charter.
- Updated before/after descriptions that demonstrate the result is still recognizably the *same* data-dense ProtonDB personality (not a richer evolution of it).

**Re-submission Process**: Agent 2 must deliver a revised `tier-1-surface-elevation-interaction-spec.md` (or a clear diff + summary) to the Guardian. Only after the Guardian publishes an updated "Phase A Locked" addendum will Phase B builders be authorized to implement any elevation/hover work.

---

## 5. Impact on Mandatory Evidence Checklist & Phase B

- The color foundations work (accepted) is a prerequisite for high-quality, reliable evidence capture on all required surfaces.
- No elevation/hover changes may be implemented until the revised Agent 2 spec is approved. Any work begun on the current elevation proposal will be considered out of scope and subject to rollback.
- Once the conditions above are satisfied, the Guardian will require fresh baseline + after evidence on the full checklist (home trending grid, ReportCard lists, SubmitReportDialog, GameCard anatomy, banner rows, etc.) using the *restrained* version.

---

## 6. Final Guardian Statement

The color foundations specification from Agent 1 is model Phase A work: it protects the system, eliminates technical debt in the token layer, and enables safe future craft without introducing any new visual language.

The surface elevation specification from Agent 2, in its current form, does not meet the high bar the Guardian Charter was written to enforce. It proposes too many new elements, new metaphors, new motion timing, and new hard-coded colors on the most sacred surfaces (especially ReportCard).

I am applying the same rigor I used when authoring the charter. The goal is high craft without personality drift. The current elevation proposal would constitute drift.

**Next Action for the Swarm**:
1. Proceed with Agent 1 color foundations implementation (safe to start).
2. Agent 2: Revise the elevation spec per the exact conditions in Section 4.
3. Re-submit the revised elevation spec to Agent 3 for final gate review.
4. Only after the Guardian issues the explicit clearance signal ("Phase A Locked — Phase B Cleared") may builders begin work on any hover, elevation, or surface depth changes.

This decision is final for the current submissions. Questions of interpretation must be directed to the Guardian.

**Signed**:  
Agent 3 — Visible Results & Consistency Guardian  
Tier 1 Visual Polish Swarm

---

**End of Phase A Review Decision**