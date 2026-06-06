# Performance Data Viz (Game Detail) — Design Spec

**Date:** 2026-06-06
**Phase:** 1 of 4 in the Polish & UX initiative (sequence: **Perf data viz** → Submit flow → Browse & filter → Mobile & density)
**Approach:** A — "Pure CSS/SVG bars, no new dependencies" (selected by user)
**Status:** Design approved by user. Worktree branch `worktree-feature+perf-data-viz`. Ready for spec commit → self-review → user review gate → writing-plans.

---

## Goal (One Sentence)

Replace the text-only Community Stats on the game detail page with at-a-glance performance visuals — a ProtonDB-style segmented tier-distribution bar, scaled average-FPS-by-resolution bars, and an optional "your rig lands here" marker — using only existing design tokens, the established tier palette, and zero new dependencies.

---

## 1. Scope, Principles & Non-Goals

**Must deliver:**
- A segmented horizontal **tier-distribution bar** (the signature ProtonDB look) replacing the current 2-column percentage grid in the Community Stats card.
- **Average-FPS-by-resolution bars** (horizontal, scaled to the max value, color-coded by FPS threshold) replacing the current text list.
- A **"your rig lands here" marker** on the distribution bar, shown only when a rig is saved, driven by the existing `predictForUserRigAsync(myRig, game.id)`.
- A small **pure-logic helper module** with focused unit tests.
- Loading skeletons updated to match the new bar layouts.

**Non-negotiable boundaries:**
- Zero changes to data/aggregation logic: `lib/data.ts` (`computeGameStatsAsync`, `predictForUserRigAsync`), `lib/mock-data.ts`, similarity, types. Consume existing outputs only.
- No new dependencies (matches the project's established rule).
- No theme, `globals.css`, or Tailwind config changes — reuse existing tier color classes/tokens used by `PerformanceBadge`.
- No new routes or pages.
- Scope is the **Community Stats card** in `app/games/[slug]/page.tsx` only. Reusing the bars elsewhere (`GameCard`, home) is explicitly future work, not Phase 1.
- The "most common preset" line and overall card layout/density are preserved.
- ReportCard, filters, and the rest of the page are untouched.

**Success criteria:**
- The Community Stats card communicates the tier mix and FPS-by-resolution visually within a glance, with no regression to information density.
- When a rig is saved, the user sees where their hardware is predicted to land on the distribution bar.
- `npm run lint` and `npm run test` are clean; the new pure helpers are unit-tested.
- No visual or interaction regressions elsewhere on the page.

---

## 2. Data Inputs (already available — no backend work)

From the existing `statsQuery` (`computeGameStatsAsync(game.id)` → `GameStats`):
- `tierDistribution: Record<PerformanceTier, number>` (counts per tier)
- `avgFpsByResolution: Record<string, number>`
- `mostCommonPreset: GraphicsPreset | null`
- `avgFpsOverall: number`
- `totalReports: number`

For the rig marker — a **new React Query** added to `GameDetailInner`:
- `queryKey: ['game-prediction', game.id, myRig?.id ?? 'none']`
- `enabled: !!myRig`
- `queryFn: () => predictForUserRigAsync(myRig!, game.id)` → `PredictionResult` (`predictedTier`, `confidence`, …)

Only `predictedTier` and `confidence` are consumed by the viz.

---

## 3. Pure Helper Module — `lib/chart-helpers.ts`

All math/ordering lives here so components stay thin and the logic is unit-testable.

```ts
import type { PerformanceTier } from '@/lib/types';

export interface TierSegment {
  tier: PerformanceTier;
  count: number;
  pct: number;      // 0-100, rounded for display
  rawPct: number;   // unrounded, for bar flex-basis / width
}

// Fixed display order, best → worst.
export const TIER_ORDER: PerformanceTier[] =
  ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];

// Returns ALL five tiers in TIER_ORDER with pct/rawPct.
// Consumers skip zero-count segments in the bar but keep them in the legend.
export function tierSegments(
  distribution: Record<PerformanceTier, number>,
  total: number
): TierSegment[];

// Order resolution keys by pixel area ascending→descending (config decides).
// Parses "1920x1080" / "1920×1080" / "1080p" / "4K" etc.; unknown keys sort last, stably.
export function sortResolutions(keys: string[]): string[];

// Bar fill percentage for a single FPS value relative to the max across rows.
export function fpsBarPct(fps: number, maxFps: number): number; // 0-100

// FPS threshold bucket used for bar color. Buckets: <30, 30-59, 60-119, 120+.
export type FpsBucket = 'low' | 'ok' | 'good' | 'high';
export function fpsBucket(fps: number): FpsBucket;
```

Notes:
- `tierSegments`: `pct = Math.round(count/total*100)`, `rawPct = count/total*100`; when `total === 0`, all pct/rawPct are 0.
- `sortResolutions`: deterministic and stable; resolutions are displayed worst-known-fit last. Implementation orders by parsed pixel area **descending** (1440p above 1080p reads naturally as "more demanding first"); final direction confirmed in the plan, but the helper exposes the parsed area so either direction is trivial.
- `fpsBucket` maps to color classes in the FPS-bars component (not in the helper — the helper returns the semantic bucket only, keeping it free of Tailwind strings).

---

## 4. Component — `components/charts/tier-distribution-bar.tsx`

**Props:**
```ts
interface TierDistributionBarProps {
  distribution: Record<PerformanceTier, number>;
  total: number;
  predictedTier?: PerformanceTier | null; // rig marker; omit/null = no marker
  confidence?: number;                     // 0-1, for marker label
}
```

**Render:**
- A full-width rounded track (`h-3`–`h-4`, `rounded-full`, `overflow-hidden`, `border-border`/`bg-muted`).
- Inside: one segment per **non-zero** tier (from `tierSegments`), each `style={{ width: \`${rawPct}%\` }}`, colored from the **same palette as `PerformanceBadge`** (reuse the existing `badge-*` / tier color treatment; the exact class mapping is resolved during implementation by reading the tier color definitions in `globals.css`). Adjacent segments separated by a hairline.
- **Legend** below the bar: all five tiers in `TIER_ORDER`, each a swatch + label + `pct%` (`tabular-nums`). Zero-count tiers shown muted.
- **Rig marker** (when `predictedTier` set): a small pin/caret anchored over the predicted tier's segment, plus a label "Your rig (~NN% confidence)". If `confidence` is low (e.g. `< 0.34`), the marker and label render muted and read "estimate" instead of a confidence %. If the predicted tier has a zero-count segment, the marker anchors at the corresponding position in the legend/track region rather than a non-existent segment (graceful: pin sits at the start of that tier's notional slot).
- **Empty state** (`total === 0`): render a dashed empty track with muted "No reports yet" — no divide-by-zero, no marker.
- **A11y:** wrapping element `role="img"` with an `aria-label` summarizing the distribution (e.g. "Tier distribution: 40% Excellent, 35% Good, …"); legend text carries label+% so color is never the sole signal.

---

## 5. Component — `components/charts/fps-resolution-bars.tsx`

**Props:**
```ts
interface FpsResolutionBarsProps {
  avgFpsByResolution: Record<string, number>;
}
```

**Render:**
- Rows ordered via `sortResolutions`. Each row: resolution label (left, fixed-ish width, `tabular-nums`), a horizontal bar (flex-1) whose fill width is `fpsBarPct(fps, max)`, and the numeric `NN FPS` (right, `tabular-nums`, `font-medium text-foreground`).
- Bar fill color mapped from `fpsBucket(fps)`: low → muted/amber, ok → neutral, good → emerald-ish, high → cyan-ish (using existing token-friendly utility colors already present in the codebase; no new CSS).
- A subtle **60-FPS reference tick** overlaid on each track (or a single shared gridline) positioned at `fpsBarPct(60, max)` when `max >= 60`.
- **Empty state** (no keys): the existing "Not enough data yet." muted line is preserved.
- **A11y:** each row is readable text (label + value); bars are decorative reinforcement.

---

## 6. Integration — `app/games/[slug]/page.tsx`

Inside the existing **Community Stats** card (the `rounded-2xl border border-border bg-card p-5` block, currently ~lines 297–368):

- Replace the tier-distribution 2-col grid (~333–343) with:
  ```tsx
  <TierDistributionBar
    distribution={stats.tierDistribution}
    total={stats.totalReports}
    predictedTier={predictionQuery.data?.predictedTier ?? null}
    confidence={predictionQuery.data?.confidence}
  />
  ```
- Replace the "Average FPS by Resolution" text block (~345–359) with:
  ```tsx
  <FpsResolutionBars avgFpsByResolution={stats.avgFpsByResolution} />
  ```
  (keep the "Average FPS by Resolution" heading + the `border-t pt-4` separator).
- Keep the `mostCommonPreset` line unchanged.
- Add the prediction `useQuery` (Section 2) alongside the existing `statsQuery`.
- Update the loading-skeleton branch (~308–330) so the skeleton roughly matches the new shapes: one wide bar skeleton for the distribution + a few horizontal row skeletons for the FPS bars. Keep it dense.
- The existing "Your saved rig is active…" teaser (~371–375) stays; the marker complements it.

No other part of the page changes.

---

## 7. Testing & Verification

**Focused unit tests — `tests/chart-helpers.test.ts`** (Node test runner via `npm run test` / `tsx --test`):
- `tierSegments`: correct pct/rawPct, all five tiers present and ordered, `total === 0` yields all-zero, rounding behavior.
- `sortResolutions`: parses `1920x1080`, `2560×1440`, `3840x2160`, `1080p`, `1440p`, `4K`; orders by pixel area; unknown keys sort last and stably.
- `fpsBarPct`: 0 when max is 0; clamps to 0–100; proportional values.
- `fpsBucket`: boundary values 29/30/59/60/119/120.

**Manual smoke (`npm run dev`):**
1. Game with several reports: distribution bar + FPS bars render, densities feel right, percentages match prior text values.
2. Save a rig → marker appears over a tier with a confidence/estimate label; reflects sign-in/out via the existing auth listener.
3. Game with zero reports: dashed empty track + "Not enough data yet."; no console errors, no marker.
4. Single-resolution game: that bar fills to 100%; no layout break.
5. Toggle `NEXT_PUBLIC_USE_REAL_DATA` (if Supabase configured): same visuals from real aggregation.

**Static verification:** `npm run lint` clean; `npx tsc --noEmit` clean. (Per project note, do **not** run `next build` against a live dev server — verify with tsc/eslint + tests.)

---

## 8. Files Touched / Created

**New:**
- `lib/chart-helpers.ts`
- `components/charts/tier-distribution-bar.tsx`
- `components/charts/fps-resolution-bars.tsx`
- `tests/chart-helpers.test.ts`

**Modified:**
- `app/games/[slug]/page.tsx` (swap two stats sub-blocks, add prediction query, reshape skeleton)

**No other files touched.**

---

## 9. Self-Review

- [x] No "TBD"/"TODO"/placeholder requirements; one direction-of-sort detail explicitly deferred to the plan with the helper designed to support either, not left ambiguous in behavior.
- [x] Internal consistency: data inputs in §2 match the consumers in §4–§6; helper API in §3 matches its test list in §7.
- [x] Scope is a single, reviewable card on one page; clearly bounded; reuse-elsewhere explicitly deferred.
- [x] All work is additive (new files) plus a contained swap inside one card — no risk to the data adapter, similarity, or other surfaces.
- [x] No-new-deps and no-theme-change constraints honored; reuses the existing tier palette.
- [x] Verification avoids `next build` against the dev server per the recorded project note.

---

**Next per process:** Commit this spec → user reviews the committed file → on approval, invoke the writing-plans skill to produce the implementation plan. This is Phase 1 of 4; Phases 2–4 each get their own spec → plan → build cycle.
