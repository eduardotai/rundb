# Phase 7 Planner Agent #2: UI Surfaces & User Experience — Community Hardware Similarity

**Project:** RunDB / grokbuild — Community Hardware Similarity Experience  
**Focus:** All new and enhanced user-facing interfaces so users feel their declared rig is meaningfully compared against real reports from similar hardware.  
**Date:** 2026-05-26  
**Prerequisites (Mandatory):** Phase 6 hardware catalog + validation (static `lib/hardware-performance-catalog.ts`, `validateHardwarePerformance`, `HardwareValidationResult`, `perfIndex`, `getCanonicalHardware`, `CATALOG_VERSION`, RigHealthCard, RigConsistencyPanel, HardwareMatchBadge, PlausibilityIndicator, etc. per MASTER + Planners 1-4) + new Phase 7 similarity engine (Planner 1 of Phase 7: hardware-aware `calculateHardwareSimilarity`, `findSimilarHardwareReports`, `getPerformanceDistributionForSimilarRigs`, `computePercentileAmongSimilar`, `getTopSimilarReports` etc. using catalog perfIndex + context factors).  
**Core User Feeling:** "When I declare my rig, the site shows me real data from people with truly comparable PCs — not just 'RTX 40 series' — with distributions, my percentile, and actionable insights."

This plan is coordinated with Phase 7 Planner 1 (similarity engine + pure functions + types + data adapter extensions). All surfaces maintain 100% anon/auth + real/mock (`NEXT_PUBLIC_USE_REAL_DATA`) parity via the existing adapter pattern (`loadMyRigAsync`, `predictForUserRigAsync`, pure fns). Non-accusatory, educational, delightful tone (ProtonDB-inspired). Mobile-first, accessible, reuse existing design system (Card, Badge, PerformanceBadge, emerald/amber tokens, lucide icons, Sonner, ReportCard patterns, RQ hooks).

---

## 1. Executive Summary & Key UX Goals

**Current State (pre-Phase 7, post-Phase 6 foundation):**
- Crude similarity in `calculateSimilarity` (GPU series keyword + CPU tier + RAM diff) → "XX% match to your rig" emerald pill in ReportCard (if >65) and `predictForUserRig*` (top 5 matches drive tier/explanation/recommendedSettings).
- `predictForUserRigAsync` / `usePrediction` / `predictForUserRigFromReports` used in:
  - `components/compatibility-checker.tsx` (predictions + sample compact ReportCards).
  - `app/games/[slug]/page.tsx` (ReportCard pass-through with `userRig` for highlighting).
  - `lib/data.ts` (re-exports + `usePrediction` hook).
  - Home page embeds checker; `/compatibility` full page.
- `components/profile-rig-editor.tsx` + `compatibility-checker.tsx` save paths (no health post-Phase 6 yet).
- `app/my-reports/page.tsx`: Placeholder (needs real list + hardware match).
- No distributions, no percentiles, no "reports from similar hardware" dedicated surfaces, no deep integration of catalog perfIndex into community comparisons.
- RigConsistencyPanel / RigHealthCard exist per Phase 6 Agent D worktree (from Planner 3 §7, §3) but are basic (rig vs *user's own* reports only; no community similar-rig benchmarks).

**Phase 7 Deliverable Vision:**
Users with/without a saved rig see rich, trustworthy "similar hardware" comparisons:
- Game pages: Dedicated "Reports from similar hardware" section (top N + "View all similar" + mini distribution + your percentile if rig saved).
- Compatibility checker: Enhanced prediction cards with hardware similarity score (perfIndex-based), FPS distribution viz for similar rigs, percentile callout, richer similar reports grid.
- Rig Consistency Panel enhancements: "How does my rig compare to the community on similar hardware?" — community benchmarks + your reports' placement.
- Personalized views everywhere a rig is active (emerald "Your rig" context + "You rank in top X% of similar hardware users").
- Visualizations: Accessible CSS/SVG bar histograms, percentile pills/badges, top-similar lists (enhanced ReportCard or new compact variant).
- Education: Inline "How we match similar hardware" (references catalog perfIndex, tolerances, why not just series match).
- New/updated components: `SimilarHardwareReportsList`, `HardwareDistributionChart`, `PercentileBadge`, `RigCommunityComparison`, updates to `RigConsistencyPanel`/`RigHealthCard`/`ReportCard`.
- Submit dialog / my-reports / profile: Light touchpoints for education + CTAs to checker/panel.
- Full parity, responsive (stacked on mobile), a11y (aria, keyboard, reduced-motion, high-contrast, screen-reader friendly numbers).

**Phasing within Phase 7 (aligns overall project):**
- MVP (immediate): Engine integration + game page similar-hardware section + checker enhancements + education copy + core new components + ReportCard polish. Uses existing `predict*` + new similar fns.
- Polish: Full RigConsistencyPanel + RigHealthCard updates, my-reports implementation, global reports browser integration, mobile/a11y pass, percentile everywhere.
- Future: Interactive charts (if lightweight lib added), "compare two rigs" mode, per-game similar-hardware leaderboards.

**Invariants:**
- Pure client-side viz + engine calls after fetch (no N+1; reuse `getReportsForGameAsync` + new `getSimilarHardwareReportsForGameAsync` wrappers).
- Emerald for positive "your rig / similar match", amber for education/warnings (consistent with Phase 6 validation).
- Wide tolerance language in education ("similar = within ~12-18 combined perfIndex points + resolution/preset context").
- No breaking changes to existing ReportCard / checker flows.
- All new surfaces degrade gracefully (no rig = community aggregate only; unknown hardware = broader similar band).

---

## 2. Integration Points with Phase 7 Similarity Engine (from Planner 1)

**Assumed new pure functions** (Planner 1 delivers; this plan consumes; add to `lib/mock-data.ts` + re-export in `lib/data.ts` exactly like `predictForUserRigFromReports` / `calculateSimilarity`):

```ts
// In lib/hardware-similarity-engine.ts (or co-located in mock-data + catalog synergy)
export function calculateHardwareSimilarity(report: Report, userRig: UserPC): number; // 0-100, perfIndex-weighted (GPU 70-80% + CPU + RAM/res/preset factors). Uses getHardwarePerf + canonicals.
export async function findSimilarHardwareReports(gameId: string, userRig: UserPC | null, options?: { minScore?: number; limit?: number }): Promise<Report[]>;
export function getPerformanceDistributionForSimilarRigs(reports: Report[], userRig?: UserPC): HardwareDistribution; // { buckets: Array<{range: string, count: number, avgFps: number}>, totalSimilar: number, userPercentile?: number }
export function computePercentileAmongSimilar(userFps: number, similarReports: Report[]): number; // 0-100, your rank
export function getTopSimilarReports(reports: Report[], userRig: UserPC, limit?: number): Array<{report: Report, similarity: number, percentileContext?: string}>;
export interface HardwareDistribution { ... } // + types in lib/types.ts
export interface SimilarHardwareResult { similarCount: number; avgFpsSimilar: number; yourPercentile?: number; topReports: Report[]; distribution: HardwareDistribution; explanation: string; }
```

**Wiring (coordinated with Planner 1):**
- `lib/data.ts`: Add `getSimilarHardwareReportsForGameAsync(gameId, userRig?)`, `computeSimilarHardwareStatsAsync(...)`, `useSimilarHardwareReports(gameId, userRig)`, wrappers that fetch via adapter then call pure engine fns (fallback to mock). Extend `usePrediction` optionally or add `useSimilarHardwarePrediction`.
- `lib/types.ts`: New: `HardwareDistribution`, `SimilarHardwareInsight`, `RigPercentileInfo`, augment `PredictionResult` optionally with `similarHardware?: SimilarHardwareResult`.
- `lib/hardware-performance-catalog.ts` synergy: Engine reuses `getHardwarePerf` / `perfIndex` for scoring (bonus to existing series match).
- Existing `calculateSimilarity` kept for backward compat; new engine is "v2 hardware-aware" default for Phase 7 surfaces. Old calls in ReportCard can migrate gradually or stay (dual badges possible during transition).
- Performance: All pure + on already-fetched subsets (like current predict). Limit similar sets to 200-300 reports max.

**Files modified for integration (minimal):**
- `lib/types.ts` (new interfaces + optional fields).
- `lib/mock-data.ts` (pure engine impl + tests).
- `lib/data.ts` (async adapters + RQ hooks + re-exports).
- No changes to `app/actions/reports.ts` (similarity is read-only post-submit).

---

## 3. Surfacing "Reports from Similar Hardware" on Game Detail Pages

**Primary location:** `app/games/[slug]/page.tsx` (right column or new full-width section below filters/reports, above bottom CompatibilityChecker).

**UX Flow & Feel (when user has saved rig):**
- Hero teaser (replaces/enhances current emerald "Your saved rig is active"): "X reports from hardware similar to your RTX 4070 + 7800X3D (87% avg match). You are in the 72nd percentile for FPS in this group."
- Dedicated "Reports from similar hardware" card/section:
  - Header: "Similar Hardware Reports (perf-matched via catalog)" + info icon → education popover ("We match on GPU/CPU relative performance scores from our curated catalog, not just model names. Tolerance accounts for OC, resolution, etc.").
  - Top 3-4 mini ReportCards (reuse `<ReportCard compact userRig={myRig} showSimilarityScore />` — new prop for hardware sim % + small percentile tag if available).
  - "View all Y similar reports →" button (filters the main list client-side or links with query param; or opens modal with full list + distribution).
  - Inline mini visualization: Horizontal bar distribution (CSS grid/flex bars) showing FPS buckets for similar rigs (e.g. <40 | 40-60 | 60-90 | 90+), highlighted bar for "your rig's reported FPS if you have one for this game" or predicted.
  - Percentile badge: Large emerald pill "Top 28% of similar rigs" (click → tooltip: "Among 47 reports within 15 perfIndex points...").
- When **no rig saved**: "Community reports by hardware tier" (aggregate buckets using engine on all reports; CTA "Save your rig for personalized similar-hardware matches").

**Exact insertion (after existing filters + before main reports list or as sibling section):**
- Use existing RQ data (`filteredReportsQuery` + new `useSimilarHardwareReports(game.id, myRig)`).
- On rig change (via listener or `useMyRig`): auto-refetch similar set.
- Mobile: Stacks vertically; bars become compact pills; "View all" full-width.

**New component:** `components/similar-hardware-reports-list.tsx`
- Props: `gameId: string; userRig?: UserPC | null; onReportClick?: (r: Report) => void; maxVisible?: number; showDistribution?: boolean`.
- Internals: Calls data hook, renders grid of compact ReportCards (pass `similarityScore` computed), optional `<HardwareDistributionChart distribution={...} userFps={...} />`.
- Reusable in checker, my-reports, global reports.

**Education copy example (in popover or collapsed <details>):**
"We define 'similar hardware' using relative performance scores (perfIndex) from our curated catalog (sourced from PassMark + TechPowerUp). Your rig's combined score is compared to each report's. Matches within ~15 points + resolution context count as similar. This is more accurate than model names alone because an overclocked 4070 can outperform a stock 4080 in some cases."

**Files changed:**
- `app/games/[slug]/page.tsx`: Import new hooks/components; add section + state for similar filter toggle; pass `userRig` more prominently; add education trigger.
- `components/report-card.tsx`: Add optional `showHardwareSimilarity?: boolean` (renders perf-based % + tiny catalog icon instead of/in addition to old series match). Keep backward compat.
- `components/similar-hardware-reports-list.tsx` (new).

---

## 4. Enhancements to Compatibility Checker

**File:** `components/compatibility-checker.tsx`

**Current UX:** Form → Save → Select games → Prediction cards (explanation + tier badge + recommended + 3 sample ReportCards via old similarity).

**New UX (rich "Community Hardware Similarity" view):**
- Post-save success: Rich toast + inline `<RigHealthCard>` (Phase 6) + new "See community comparisons for your rig" CTA that pre-fills games or opens expanded mode.
- Per-game prediction card enhancements (inside the results grid):
  - Prominent new header line: "Hardware similarity: 82% (catalog perf match)" + tooltip.
  - Below existing prediction: New `<HardwareDistributionChart>` (small, horizontal bars or sparkline-style) for similar-rig FPS in that game + "Avg FPS on similar hardware: 78 (your predicted: 82)".
  - Percentile callout (if rig active): "You would rank ~65th percentile among similar rigs on this title."
  - Expanded similar reports: Grid of 4-6 compact cards (instead of 3) with hardware sim % badges. "Top matches from truly comparable PCs".
  - "Run full similar-hardware scan for all my games" button → opens or links to a dedicated view (or RigConsistencyPanel variant).
- No-rig state: Stronger education + "Save rig to unlock personalized similar hardware predictions + percentiles".
- Embedded mode (game pages): Same enhancements, slightly denser.

**New supporting component:** `components/hardware-distribution-chart.tsx`
- Pure presentational. Props: `distribution: HardwareDistribution; highlightFps?: number; variant?: 'full' | 'compact' | 'inline'; userLabel?: string`.
- Impl: CSS flex/grid bars (color-coded by tier or neutral slate), labels, counts, accessible (aria-describedby table fallback or sr-only data). No external chart lib (keeps bundle light; consistent with ProtonDB data-dense aesthetic).
- Optional SVG for smooth curves if needed for polish.

**Files changed:**
- `components/compatibility-checker.tsx`: Heavy updates to results JSX + new state/effects for similar data (parallel to existing predict fetch); import/use new components + hooks; richer save success.
- `components/hardware-distribution-chart.tsx` (new).
- Minor: `lib/data.ts` for any new hooks used here.

**Feel:** When you save a mid-high rig and check Cyberpunk, you see not generic "Good" tier but "On rigs like yours (RTX 4070-class + 7800X3D), community averages 72 fps at 1440p High — you sit comfortably in the upper quartile."

---

## 5. Enhancements to Rig Consistency Panel + New Visualizations

**Assumed base (from Phase 6 Agent D worktree per Planner 3 §7):** `components/rig-consistency-panel.tsx` triggered from profile/my-reports/checker. Shows "X of Y of *your* reports consistent with current rig" using `validateHardwarePerformance` (plausibility vs *your declared rig*). List of outliers, "Run scan", celebratory empty state.

**Phase 7 Enhancements (community layer):**
- New tab or section: "Community benchmarks for your rig" (or integrated view).
  - "How your reported FPS compare to others with similar hardware":
    - For each of your reports (or top games): Show your FPS + "Similar hardware avg: XX (Y reports)" + percentile badge for *your* entry among the similar cohort for that game.
    - Visual: Per-report row or card with mini distribution bar (your FPS marker as emerald dot on the community similar-hardware histogram).
  - Aggregate "Rig Health vs Community": Overall "Your reports place you in top 35% of similar-hardware players across your library."
  - "Top similar community reports that beat / match your performance" lists (positive reinforcement).
- "Validate my reports + compare to community" primary action (runs both Phase 6 plausibility + new similar-engine percentile).
- Empty/good state upgrade: "Your data is rock-solid and sits beautifully among similar rigs in the community. Thank you!"

**New visualization primitives (reusable):**
- `components/percentile-badge.tsx`: Props `{ percentile: number; size?: 'sm'|'md'; context?: string }`. Renders emerald/amber/slate pill "Top 15%", "42nd percentile", with color scale (top 20% strong emerald, mid amber-neutral, lower subtle).
- Enhanced `HardwareDistributionChart` supports "user marker" (your report FPS or predicted) overlaid on similar-hardware bars + percentile annotation.
- Mini sparkline or bucket bars for RigConsistencyPanel rows.

**Files changed:**
- `components/rig-consistency-panel.tsx` (major update; add community tab/section, new props for "includeCommunity" or dual-mode; integrate new chart + percentile components + engine calls via data hooks).
- `components/percentile-badge.tsx` (new).
- `components/rig-health-card.tsx` (Phase 6): Enhance post-save to include "Community rank insight" teaser + CTA to panel (e.g. "Your rig would be strong — see how it stacks vs similar community reports").
- Wire triggers: `components/profile-rig-editor.tsx`, `components/compatibility-checker.tsx`, `app/my-reports/page.tsx`, `app/profile/page.tsx`.

**UX copy example (in panel):**
"3 of your reports are from hardware that closely matches community clusters. On Black Myth: Wukong your 94 fps puts you in the 81st percentile of similar RTX 4070 + Ryzen 7 rigs."

---

## 6. Personalized Community Comparisons for Users with Saved Rig

**Everywhere a rig is loaded (`useMyRig`, `loadMyRigAsync` listeners):**
- ReportCard (all contexts: game page, checker samples, global reports, my-reports): Enhanced similarity badge now defaults to hardware-aware % (from new engine) + optional small "Community context" line if space ("+12 fps above similar avg").
- My Reports page (full build-out of placeholder):
  - List of *your* reports (real query: user-owned via RLS or local for demo).
  - New columns/badges: Hardware Match (reuse/enhance `HardwareMatchBadge` from Phase 6) + "Community Percentile" (your FPS vs similar hardware cohort for that game).
  - Top summary: "Across your 14 reports, you average 68th percentile on similar hardware. 4 reports are in the top 20% for their rigs."
  - Per-report expandable: Distribution snippet + "See all similar community reports for this game" link (to game page with filter).
- Profile page: Below `ProfileRigEditor`, surface `<RigHealthCard>` + "Community view" teaser card linking to consistency panel or dedicated "My Rig in the Community" section.
- Global `/reports` browser: Optional "Similar to my rig" quick filter pill (when rig saved) that applies engine scoring server/client.
- Submit dialog (light): Footer education "Your hardware will help others with similar rigs find realistic expectations." Optional post-submit success banner with "See how your report compares once approved" (future).

**Files:**
- `app/my-reports/page.tsx` (major: implement list using RQ + new similar hooks + badges/charts; full responsive table → cards on mobile).
- `app/profile/page.tsx` (add sections + import Rig* components).
- `components/report-card.tsx` (props + rendering for community percentile when provided).
- `app/reports/page.tsx` (optional filter integration).
- All rig-loading components get `useMyRig()` where beneficial for reactivity.

**Personalization principle:** Rig saved = "This is about *you* in the community of similar players." No rig = beautiful aggregate community data + strong save CTA.

---

## 7. Mobile/Responsive, Accessibility, Education/Copy, Design System

**Responsive:**
- All new sections: `flex-col` default; distribution bars wrap or become vertical stacks <md.
- Cards/grids: 1-col mobile → 2/3 desktop (existing patterns).
- Touch targets: 44px+ for all interactive (badges, chart segments if tappable for details, CTAs).
- Checker/game pages: Prediction + similar sections stack cleanly; modals/drawers for "full similar list" on small screens.
- My Reports: Table collapses to stacked cards with key stats (FPS, your percentile, similar avg) prominent.

**Accessibility (a11y):**
- All new viz: `role="img" aria-label="FPS distribution for similar hardware: 12 reports below 50 fps, ..." ` + visible data table (sr-only or collapsed details).
- Percentile badges + sim %: Text + color (never color alone); `aria-describedby`.
- Education popovers: Keyboard accessible (existing Popover or native `<details>` + summary).
- Focus states, high-contrast (reuse tokens; test with forced-colors).
- Screen reader: "You are in the 72nd percentile among 47 players with comparable hardware" announced naturally.
- Reduced motion: No auto-anim bars unless user prefers.
- Existing patterns followed (focus-visible, aria on ReportCard expanders, etc.).
- New components document a11y in comments.

**Education / Copy Strategy (consistent, delightful, transparent):**
- "Similar hardware" always explained on first surfaces + globally via reusable `<HowHardwareSimilarityWorks />` (new small component or extend Phase 6 `HowWeValidateInfo`).
  - Content outline: "We use relative performance scores (perfIndex) from a curated catalog... GPU/CPU weighted... accounts for real variance... more precise than 'same GPU model'."
  - Link to catalog version + sourcing (cross-ref Phase 6).
- Inline everywhere: Subtle "(via catalog v2026.05.26)" next to scores.
- Positive default language: "Community with rigs like yours", "You sit comfortably among...", "Helping players with comparable PCs".
- Edge: "Broader match used (limited similar reports for this exact config)" — graceful.
- Submit/profile/checker footers: One-sentence education.

**Design System Reuse + New Tokens (minimal):**
- Existing: emerald-500/10 + text-emerald-400 for positive similarity/percentile (top quartile); amber for education; slate for neutral.
- New CSS (in globals.css): `.percentile-top` variants, `.sim-bar` for distribution segments (tier-tinted or neutral), `.hardware-match-score`.
- Icons: Zap (current similarity), BarChart3 or Activity for distribution, Info for education, TrendingUp for percentile.
- All new cards follow `Card` + dense p-4/5 + border-border/60 patterns.
- No new deps.

**New Components Summary (all small, reusable, ~100-250 LOC each):**
1. `components/similar-hardware-reports-list.tsx`
2. `components/hardware-distribution-chart.tsx`
3. `components/percentile-badge.tsx`
4. `components/rig-community-comparison.tsx` (optional wrapper for panel/profile)
5. `components/how-hardware-similarity-works.tsx` (or section)
6. Updates only (no new file) to: RigConsistencyPanel, RigHealthCard, ReportCard, profile-rig-editor, compatibility-checker, game detail, my-reports.

**Other files:**
- `lib/types.ts` (new interfaces).
- `lib/data.ts` + `lib/mock-data.ts` (engine + hooks — Planner 1 primary, this plan references exact exports needed).
- `app/globals.css` (viz styles + percentile variants).
- `README.md` + any PHASE docs (brief "Phase 7 UI surfaces" note).
- Tests: Manual E2E matrix (with/without rig, real/mock, mobile viewport) + unit for pure viz helpers if extracted.

---

## 8. Detailed File-by-File Change Plan (Actionable)

**New files (create):**
- `components/similar-hardware-reports-list.tsx`
- `components/hardware-distribution-chart.tsx`
- `components/percentile-badge.tsx`
- `components/how-hardware-similarity-works.tsx` (if separate)
- `plans/phase7-planner-2-ui-surfaces-plan.md` (this doc)

**Major modifications:**
- `app/games/[slug]/page.tsx`: +80-120 LOC for similar section + hook + education + mobile tweaks.
- `components/compatibility-checker.tsx`: +150 LOC for viz + enhanced cards + save integration.
- `components/rig-consistency-panel.tsx`: +100 LOC community layer (assumes Phase 6 base exists).
- `components/report-card.tsx`: +30 LOC (new prop + conditional hardware sim rendering).
- `app/my-reports/page.tsx`: Complete rewrite from placeholder (~200+ LOC) with lists, badges, charts, CTAs.
- `components/profile-rig-editor.tsx`: +40 LOC (post-save RigHealthCard + community CTA + education).
- `lib/types.ts`: ~40 LOC new interfaces.
- `lib/data.ts`: ~60 LOC new async fns + hooks + re-exports (coordinate exact names/signatures with Planner 1).
- `lib/mock-data.ts`: Engine impl (coordinate; or thin wrappers).
- `app/globals.css`: ~30 LOC new classes.
- `app/profile/page.tsx`: +30 LOC sections.
- Minor: `app/reports/page.tsx` (optional filter), home if needed, submit dialog footer education (tiny), `components/my-rig-indicator.tsx` (optional richer tooltip on hover).

**Coordination points (no ownership overlap):**
- Planner 1 (engine): Delivers pure fns + types + data adapters first.
- This plan (UI #2): Consumes immediately; wires surfaces.
- Any UI #3 or impl agents: Use this doc + wireframes as spec.
- Phase 6 components (Rig*): Enhanced in place (add props/sections for community data).

**Testing/Verification for UI surfaces (per Phase 6 Planner 4 spirit):**
- With/without saved rig (all pages).
- Real vs mock flag.
- Guest/anon/auth.
- Mobile (DevTools + real device sim): 320-768 widths.
- Keyboard + SR (VoiceOver/NVDA spot checks).
- Visual: Distribution bars render counts correctly; percentiles accurate vs raw data.
- E2E extension of `scripts/phase5-e2e-real-data.ts`.
- Dark launch: Feature flag for new sections if desired (`NEXT_PUBLIC_HARDWARE_SIMILARITY_UI`).

**Risks & Mitigations (UI-specific):**
- Viz overload / cognitive load: Start compact/mini; collapse by default; education opt-in.
- Data sparseness for rare rigs: "Limited matches — showing broader similar cohort (within 20 perfIndex)".
- Perf on large similar sets: Always cap (engine + UI); client pure after fetch.
- Copy drift: Centralize education strings in one component/file.
- Animation/perf: Pure CSS transforms only.

**Rollback:** Hide new sections behind simple conditional or remove imports; existing predict/similarity untouched.

---

## 9. User Experience Narratives (Concrete Scenarios)

1. **New user, no rig, visits Cyberpunk page:** Sees rich community stats + "Reports grouped by hardware performance" (engine-derived buckets). Strong "Save your rig" CTA in multiple places. Feels the database is alive with real varied PCs.

2. **User saves RTX 4070 + 7800X3D 32GB 1440p:** Immediate RigHealthCard + "See how you compare". Goes to game page → emerald "82% hardware similarity, top 28% percentile among 53 comparable rigs". Clicks distribution → sees their potential FPS placement. Trust skyrockets.

3. **Power user with 20 reports:** Opens My Reports or RigConsistencyPanel → "Your data vs similar community" view shows 3 reports where they are outliers (high) and celebrates 8 where they are above average. Exports insight or just feels valued.

4. **Mobile user on checker:** Saves rig, selects 3 games → stacked cards with tiny beautiful bar distributions + percentile pills. Taps education icon for 2-sentence explanation. "Submit report" from there feels meaningful.

5. **Anonymous guest:** Full parity — everything works in-browser; clear "Local to this browser" note on personalized views.

---

## 10. Implementation Order Recommendation & Handoff

1. Planner 1 delivers engine + data hooks + types (unblocks all).
2. Create new viz components + education component (pure, testable).
3. Wire game page similar section (highest visibility win).
4. Enhance checker (core "declare rig → feel comparison" flow).
5. Update ReportCard + Rig* components.
6. Build full my-reports + profile/profile-rig-editor touches.
7. RigConsistencyPanel community layer + final polish/a11y.
8. Cross-surface testing + copy review + docs.

**Handoff artifacts for implementers/reviewers:**
- This plan (full).
- Phase 6 MASTER + all 4 planners (for Rig* base + validation tone).
- Phase 7 Planner 1 (exact fn signatures + example outputs).
- Existing code (key files listed above).
- Wireframes (ascii in this doc + describe in PRs).

**Sign-off criteria (UI reviewer lens):** Every surface with a saved rig shows at least one hardware-similarity number + one visualization or list; education reachable in <2 taps; mobile + keyboard fully functional; no regressions in existing similarity/predict paths; anon parity perfect.

---

This plan delivers the emotional payoff of Phase 6 catalog + Phase 7 engine: users *feel* the community data working for *their exact hardware situation*. Detailed, file-specific, and ready for immediate execution alongside the engine work.

**Ready for user approval + spawning of UI implementation agent(s) (worktree isolation recommended).**

— Phase 7 Planning Agent #2 (UI Surfaces & User Experience)
