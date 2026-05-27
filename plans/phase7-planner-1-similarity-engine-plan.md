# Phase 7 Planner Agent #1: Similarity Algorithm & Matching Engine Implementation Plan

**Focus:** Core Data-Driven Community Hardware Similarity Engine — Transition from Crude Series/Tier Matching to PerfIndex Catalog-Powered Multi-Factor Rig Matching  
**Date:** 2026-05-26  
**Context:** Post-Phase 6 (Hardware Performance Catalog + Validation complete per MASTER plan + 4 planners). The original core requirement: "when a user inputs their hardware setup, the system should intelligently match it against actual reports from other players with the same or very similar hardware, and surface meaningful performance comparisons and outliers."

Phase 6 delivered the static curated `lib/hardware-performance-catalog.ts` (HardwarePerfEntry, GPU_CATALOG/CPU_CATALOG with relative `perfIndex` normalized ~100 for flagships from PassMark G3D + CPU Mark + TPU cross-refs, `getCanonicalHardware`, `getHardwarePerf`, `validateHardwarePerformance`, wide tolerance factors, CATALOG_VERSION, etc.). 

Current (pre-Phase 7) similarity (`lib/mock-data.ts:573` `calculateSimilarity`, `predictForUserRigFromReports:600`, `extractGpuSeries:551`, `getCpuTier:563`) is keyword/series-based (RTX 40/30 regex + hardcoded high/mid/low CPU keywords + RAM delta buckets). This powers:
- `predictForUserRig*` (top-5 similar reports for tier/explanation/recommendedSettings)
- ReportCard "X% match to your rig" badges (if >65%, `components/report-card.tsx:23`)
- CompatibilityChecker predictions + sample reports (`components/compatibility-checker.tsx:148`)
- Game pages (`app/games/[slug]/page.tsx:472` passes userRig)
- Real-data paths via `lib/data.ts:610` (predictForUserRigAsync fetches from Supabase `reports` table (RLS-approved only), maps via `mapDbReportToReport`, delegates to pure `predictForUserRigFromReports`)

**Goal for Phase 7:** Replace/enhance crude matching with **precise, data-driven, community similarity** using Phase 6 perfIndex catalog. Enable "top N most similar reports" that reflect real relative performance distance (GPU-dominant, with CPU, RAM, resolution). Power richer Community Hardware Similarity features: better predictions, outlier detection in Rig Consistency, hardware-bucketed community aggregates, "similar rigs" filters/stats, improved Rig Health/Consistency panels. Maintain 100% anon/auth, real/mock (`NEXT_PUBLIC_USE_REAL_DATA`), O(1)/pure hot paths where possible, non-breaking evolution of existing APIs.

This plan is concrete, references exact existing code paths (file:line from deep inspection), provides algorithm, signatures, bucketing, integration diffs, scale considerations, and coordinates with Phase 6 (validation uses same canonical/perfIndex; similarity becomes the "positive" community mirror to validation's "plausibility gate").

---

## 1. Research Summary & Current State Analysis (Codebase Inspection)

### Existing Similarity (Crude — `lib/mock-data.ts`)
- `extractGpuSeries(gpu)`: Regex on "RTX \d{2}" → "RTX 40", special cases for 4090 etc., RX, hardcoded. Returns coarse series string or null. Used in similarity + filters.
- `getCpuTier(cpu)`: Hardcoded keyword arrays for 'high'/'mid'/'low' (7800X3D etc., i7/ryzen7 → mid). No perf nuance (e.g., 5800X3D vs 5700X both "high").
- `calculateSimilarity(report, userRig)` (lines 573-592):
  - Base 50
  - GPU series exact match +30 / partial +10
  - CPU tier match +15 / adjacent +5
  - RAM |diff| <=8 +10 / <=16 +5
  - Clamped 0-100
- `predictForUserRigFromReports(userPC, gameReports)` (600-642): Scores ALL input reports via calculateSimilarity, sorts desc, takes top 5 for avgFps → tier mapping (hardcoded thresholds 90/60/40/25), confidence from top score, explanation with % match. Pure, used by both mock + real async.
- `predictForUserRig` wrapper (685): Filters all reports by gameId then delegates.
- **Weaknesses exposed by Phase 6 catalog**: No accounting for actual perf deltas within series (e.g., 4070 vs 4090 both "RTX 40" treated identically); ignores resolution scaling; no continuous distance; CPU keywords miss gaming-optimized (X3D) nuances that perfIndex captures; brittle to naming (no canonical normalization).

### Report & Query Model (`lib/types.ts:42`, `supabase/schema.sql:62`, `lib/data.ts`)
- `Report`: cpu/gpu/ram strings+int, resolution, settingsPreset, avgFps, fps1PercentLow, performanceTier (FPS-only), status, userId, moderatorNotes (Phase 6 validation writes here), createdAt.
- `UserPC`: cpu/gpu/ram + optional resolution (used in checker/profile-rig-editor).
- Real fetches (`data.ts:374-400` `getReportsForGameAsync`): Supabase `reports` SELECT * WHERE game_id=... ORDER created_at DESC (RLS limits to approved for public; mods see all via policy). Then client-side `filterReports` (pure, `mock-data:539` using gpuSeries substring etc.) + pure predict. Limit 200 on getAllReportsAsync. Indexes exist on (game_id, created_at), lower(gpu/cpu), resolution, status=approved.
- Submit path (`app/actions/reports.ts:66-151`): Auth/game lookup → rate (5/hr) + exact dup (24h on cpu+gpu+ram+res) → tier (FPS-only `calculatePerformanceTier`) → INSERT (no perf validation yet; Phase 6 adds it post-dup). No similarity here.
- My Rig: Dual (`user_rigs` table + profiles mirror; LS fallback `rundb_my_rig`). Async loaders in data.ts.

### Integration Points (Where Similarity Powers UX)
- `components/report-card.tsx:23`: `const similarity = ...; isSimilar = >65`; renders emerald "% match to your rig" pill when myRig active (game page passes it at 472).
- `components/compatibility-checker.tsx:148`: `predictForUserRigAsync(myRig, game.id)` (real path fetches reports + pure score); displays predictions + sample reports.
- `app/games/[slug]/page.tsx:348-500`: MyRig teaser ("Reports matching your hardware are highlighted"), ReportCard list with userRig prop, embedded CompatibilityChecker.
- `lib/data.ts:592-617` `predictForUserRigAsync`: Real branch does Supabase fetch → map → `mock.predictForUserRigFromReports` (note: re-exports at 1111).
- Re-exports at data.ts:1104 (`calculateSimilarity`, `extractGpuSeries`, `getCpuTier`, `predictForUserRigFromReports`).
- Phase 6 planners explicitly call out synergy: "Improves prediction/similarity (immediate win)" (planner-1:246) — add perf bonus to calculateSimilarity; prefer close-perf reports in predict. Rig Consistency (planner-3 §7) will use catalog validation + similarity for "outliers vs my rig + community".
- No existing bucketing/clustering; no perfIndex anywhere in src (only plans).

**Key Invariants for Phase 7 (from all prior phases):**
- Pure functions (no side effects, client+server safe, offline/anon parity).
- Additive: Enhance, do not break, existing predict/similarity surfaces.
- Static catalog primary for hot paths (perfIndex lookups O(1) via Record).
- Real data: Fetch reports (RLS-aware), score client-side (pure fn) or lightweight server helper later.
- Non-punitive/educational tone preserved.
- Defense-in-depth with Phase 6 validation (similarity for "community match strength"; validation for "is this FPS plausible on this rig?").
- Full real/mock + guest/anon/auth parity via data adapter + pure fns.

---

## 2. Proposed Similarity Data Model & Extensions (Leverage Phase 6 Catalog)

Extend types in `lib/types.ts` (additive; no breaking changes to Report/UserPC):
```ts
// New (or in hardware-performance-catalog.ts re-export)
export interface RigPerfScore {
  gpuPerf: number;      // perfIndex from catalog (or fallback)
  cpuPerf: number;
  combinedScore: number; // Weighted (e.g. 0.78 GPU + 0.22 CPU)
  label: 'Flagship' | 'High-End' | 'Upper-Mid' | 'Mid-Range' | 'Entry' | 'Unknown';
  canonicalGpu?: string;
  canonicalCpu?: string;
  catalogVersion: string;
}

export interface SimilarityResult {
  score: number;              // 0-100 (higher = closer match)
  factors: {
    gpuDistance: number;      // 0-1 (normalized |perf diff|)
    cpuDistance: number;
    ramDistance: number;
    resolutionMatch: number;  // bonus/penalty 0-1
    overall: number;
  };
  topMatchingReports?: Report[]; // optional for debug
  reason?: string;            // "GPU perf within 8%, CPU tier match, RAM close"
  confidence: number;         // 0-1 (catalog coverage for both rigs)
}
```

Catalog already provides (per Phase 6 planners):
- `getHardwarePerf(rawOrCanonical): HardwarePerfEntry | null` (perfIndex, series, vendor)
- Canonicalization (reuses/enhances extract* + aliases)
- Fallbacks: Unknown → ~45-52 perfIndex + low confidence.

New pure exports from catalog (or new `lib/similarity-engine.ts` importing catalog; recommended co-location or thin wrapper for clarity):
- `getRigPerfScore(rig: UserPC | Partial<HardwareSpec>): RigPerfScore`
- `calculatePerfAwareSimilarity(report: Report, userRig: UserPC | null, options?: {gameId?: string, weightOverrides?: Partial<Weights>}): number` (0-100, backward-compatible shape)
- `findTopSimilarReports(userRig: UserPC, reports: Report[], n?: number, options?): {report: Report, score: number, factors: ...}[]`
- Internal: `computePerfDistance(p1, p2, maxRange=100)`, `ramSimilarity`, `resSimilarity` (e.g. 1080p vs 1440p penalty based on perf scaling).

Weights (tunable constants in catalog, versioned):
- GPU_PERF_WEIGHT: 0.48 (dominant for gaming FPS)
- CPU_PERF_WEIGHT: 0.22
- RAM_WEIGHT: 0.15 (diminishing returns; 16GB baseline)
- RES_WEIGHT: 0.10
- SERIES_FALLBACK_BONUS: small if no perf but series match
- GAME_CONTEXT (optional Phase 7.2): per-game multiplier if future baselines table.

---

## 3. Core Multi-Factor Similarity Algorithm (Concrete, Calibrated)

Signature (in catalog or similarity module):
```ts
export function calculatePerfAwareSimilarity(
  report: Report,
  userRig: UserPC | null,
  opts: { gameId?: string; useSeriesFallback?: boolean } = {}
): number {
  if (!userRig) return 0;

  const reportG = getHardwarePerf(report.gpu)?.perfIndex ?? FALLBACK_UNKNOWN;
  const userG = getHardwarePerf(userRig.gpu)?.perfIndex ?? FALLBACK_UNKNOWN;
  const reportC = getHardwarePerf(report.cpu)?.perfIndex ?? FALLBACK_UNKNOWN_CPU;
  const userC = getHardwarePerf(userRig.cpu)?.perfIndex ?? FALLBACK_UNKNOWN_CPU;

  // Normalized distances (0 = perfect match, 1 = max diff)
  const gpuDist = Math.min(1, Math.abs(reportG - userG) / 100);
  const cpuDist = Math.min(1, Math.abs(reportC - userC) / 85); // CPU range slightly narrower

  // RAM: bucketed or continuous (e.g. target 16-32GB; penalty grows >16 diff)
  const ramDiff = Math.abs(report.ram - userRig.ram);
  const ramDist = Math.min(1, ramDiff / 32);

  // Resolution awareness (report.res vs userRig.resolution || '1920x1080')
  const resBonus = computeResolutionSimilarity(report.resolution, userRig.resolution);

  // Weighted score (invert distances)
  const w = { gpu: 0.48, cpu: 0.22, ram: 0.15, res: 0.10, base: 0.05 };
  let score = 100 * (
    w.base +
    w.gpu * (1 - gpuDist) +
    w.cpu * (1 - cpuDist) +
    w.ram * (1 - ramDist) +
    w.res * resBonus
  );

  // Series fallback boost (if perf unknown for either; preserves old behavior partially)
  if (opts.useSeriesFallback) {
    const oldSeriesScore = /* call legacy extract + tier logic scaled */;
    score = 0.7 * score + 0.3 * oldSeriesScore;
  }

  // Clamp + confidence influence (lower if unknown hardware)
  const coverage = (reportG > 40 ? 0.5 : 0) + (userG > 40 ? 0.5 : 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return Math.round(score * (0.6 + 0.4 * coverage)); // penalize unknowns
}
```

Supporting helpers (pure, documented):
- `computeResolutionSimilarity(r1: string, r2?: string): number` — map "1920x1080"→1.0, "2560x1440"→0.85 (perf cost), "3840x2160"→0.55 etc. Bonus if exact match.
- Distance can be Euclidean: `sqrt( (gDist*W_g)^2 + (cDist*W_c)^2 )` then invert/scale for score (more "geometric" feel for "rig distance").
- Optional gameId weighting (future): Heavy RT titles boost CPU weight slightly.

**Why this?** Directly uses Phase 6 perfIndex (continuous, sourced, auditable). GPU dominant mirrors real gaming bottlenecks. RAM/res handle common variance. Graceful degradation for partial/unknown (wide "fuzzy" matches via fallbacks + catalog miss notes). Tunable via constants + version bump.

For predict: Use this as primary scorer (or blend 80% new + 20% legacy for transition). Top matches now reflect true perf proximity (e.g., 4070 Ti report scores high for 4080 user rig, unlike old series match treating 4060=4070=4090).

---

## 4. Efficient Top-N Matching & Bucketing / Clustering for Scale

**Current reality:** Per-game reports typically small (hundreds max in early community). Full client-side sort on fetch is fine (<5ms for 500 reports). `predictForUserRigFromReports` already does exactly this (map+sort+slice(5)).

**Phase 7 Enhancements (pure fn):**
```ts
export function findTopSimilarReports(
  userRig: UserPC,
  reports: Report[],
  n: number = 5,
  opts?: { minScore?: number; includeFactors?: boolean }
): Array<{ report: Report; score: number; factors?: SimilarityFactors }> {
  return reports
    .map(r => ({
      report: r,
      score: calculatePerfAwareSimilarity(r, userRig),
      // factors for rich UI (outlier explanations in consistency panel)
    }))
    .filter(x => x.score >= (opts?.minScore ?? 0))
    .sort((a,b) => b.score - a.score)
    .slice(0, n);
}
```

**Bucketing for scale / pre-filter / aggregates (Phase 7.1-7.2, when reports > few thousand):**
- On report ingest (or background), compute & store (or derive) lightweight bucket keys using catalog (add to Report or separate index table later):
  - `gpuPerfBucket: Math.round(perfIndex / 5) * 5` (e.g. 75, 80, 85...)
  - `cpuPerfBucket: similar`
  - `resBucket: '1080p' | '1440p' | '4K'`
  - Composite `rigCluster: `${gpuB}-${cpuB}-${resB}``
- New indexes (future schema, non-breaking): On reports or materialized view for (game_id, gpu_perf_bucket, ...).
- Query optimization in `getReportsForGameAsync` + new `getSimilarReportsForRigAsync(userRig, gameId)`:
  - Compute user's buckets.
  - Fetch reports in user's bucket +/- 1-2 neighboring buckets (Supabase .in() or range on derived columns or JSONB perf snapshot).
  - Fallback: If too few, broaden or full scan (rare).
- Client still runs full `findTopSimilar...` on the (smaller) candidate set for precise scoring.
- Clustering ideas: K-means lite on (gpuPerf, cpuPerf) for "rig archetypes" (Flagship 4K cluster, 1080p eSports, etc.). Precompute community stats per cluster ("Avg FPS in your cluster for Cyberpunk: 78 (n=142 reports)").
- Caching: React Query keys include userRig hash (or perf buckets) + gameId. Stale 5min. In-memory LRU for pure scorer on hot paths.
- Server option (future): Postgres function `find_similar_reports(rig_json, game_id, n)` doing distance calc (perfIndex joined or pre-stored). But prefer client pure for anon/offline parity.

**Partial/Unknown Hardware Handling:**
- Catalog fallback mid perf + explicit low confidence (e.g. score capped at 65).
- In UI: "Limited match data (hardware not in catalog — using series + mid baseline)".
- Degrade to legacy series/tier logic when coverage < 0.4.
- For reports with unknown: Still surface but with "community note: hardware details partial".

**Performance Considerations:**
- Catalog lookups: O(1) Record access, <0.1ms.
- Per query (N=reports for game): O(N log N) sort worst-case. For 1000 reports: negligible on client (modern browsers).
- Memory: Reports lightweight. Fetch limits already 200 on some paths; extend predict to accept pre-filtered + paginated candidates.
- Real mode: Keep fetches lean (select only needed columns eventually: cpu,gpu,ram,resolution,avg_fps,...). Avoid SELECT * long-term.
- Benchmarks: Add micro-bench in tests asserting `findTopSimilar(1000 reports) < 10ms`.
- Scale proof: Even at 50k total reports, per-game subsets + bucketing keep working set <1k. No DB perf hit on hot paths (scoring post-fetch).
- Memoization: `useMemo` in checker/game pages keyed on rig + reports.

---

## 5. Integration Strategy with Existing `predict*` + Rig Consistency + Phase 6 Validation

**Non-Breaking Evolution:**
- Keep `calculateSimilarity` (legacy) exported forever for compatibility (or mark deprecated).
- New primary: `calculatePerfAwareSimilarity` (or rename/overload `calculateSimilarity` to accept/use catalog internally after Phase 6).
- Update `predictForUserRigFromReports` (mock-data.ts:611): Change scorer to perf-aware (primary). Keep old as fallback/option. Update explanation to "Your rig is within X% perf distance of top similar community reports (GPU perf match dominant)."
- `predictForUserRigAsync` (data.ts): Unchanged signature; now benefits automatically (better topMatches, higher confidence on real data).
- Re-exports in data.ts: Add `calculatePerfAwareSimilarity`, `getRigPerfScore`, `findTopSimilarReports`. Deprecate old in comments.
- `lib/data.ts` re-exports + async wrappers remain the single source.

**Rig Consistency (Planner 3 §7 / Phase 6 UX) Synergy:**
- `RigConsistencyPanel`: On scan, for each user report:
  1. Run Phase 6 `validateHardwarePerformance(report vs current rig)` → plausibility.
  2. Run `findTopSimilarReports(currentRig, communityReportsForGame, 10)` → "Your 142 fps is 12% above the avg of 8 similar-perf rigs (RTX 4070 cluster)".
  3. Outlier = low community similarity + validation warn.
- Use `getRigPerfScore` for "Your rig (perf ~82, High-End)" badges in health card + consistency summary.
- "Similar rigs in community" section: Aggregate top clusters from all reports (or game-specific).

**Phase 6 Validation + Similarity (Complementary):**
- Validation: "Is this FPS claim plausible for *this* rig?" (expected range from perfIndex * factors).
- Similarity: "How does this report compare to *other players with comparable perfIndex rigs*?" (empirical community distribution).
- Together: Powerful for "Your claim is 2.1x expected (block/warn) AND no similar rigs report anywhere near that FPS (strong outlier signal for mods)".
- Planner 1 §7 explicitly foresaw: perf bonus in similarity + rig score exposure.
- In submit (post Phase 6): Validation runs first (planner-2); similarity not needed there but can log "closest community match score" in moderatorNotes for context.

**File Change Map (High-Level, Additive):**
- `lib/hardware-performance-catalog.ts` (or new `lib/similarity-engine.ts`): New pure fns + constants + getRigPerfScore. Import types from catalog.
- `lib/types.ts`: Add RigPerfScore, SimilarityResult, optional fields (non-breaking).
- `lib/mock-data.ts`: Enhance predict*FromReports + calculate* (keep legacy); export new findTop*. Minimal changes to seeds.
- `lib/data.ts`: Re-export new fns; optional new `getSimilarReportsAsync(rig, gameId)` that fetches + finds top similar. Update predictAsync JSDoc.
- `components/report-card.tsx`: Use new scorer (or dual); richer tooltip with factors ("GPU perf 94 vs your 97").
- `components/compatibility-checker.tsx`: Use new predict (automatic); display rig perf score + "top similar community rigs" pills.
- `app/games/[slug]/page.tsx` + `app/my-reports/page.tsx`: Pass richer similarity; new "Community Similar" section.
- `app/actions/reports.ts`: Optional (Phase 7.2): After insert, compute closest similarity for moderatorNotes enrichment.
- Tests/E2E: Extend phase5-e2e + new unit for scorer (known perf diffs, unknown fallback, top-N ordering).
- Admin: (future) "Rig Cluster Distribution" tile using buckets.

**Migration / Rollout:**
- Dark: New scorer behind internal flag or computed in parallel (log both scores).
- Soft: Update ReportCard/Checker to prefer new (higher precision matches).
- Full: Legacy calculateSimilarity only for very old filters.
- Version: Tie to CATALOG_VERSION + new SIMILARITY_VERSION.
- Backwards: Old ReportCard badges continue to work; predictions improve silently.

---

## 6. Handling Unknown/Partial Hardware, Edge Cases, and Robustness

- Unknown canonical (no catalog entry): Fallback perf (mid 45-55), cap score <=70, include "partial data" in factors/reason. Still match on RAM/res + any series heuristic.
- Partial rig (missing CPU in UserPC): Weight GPU higher (0.65); note "CPU unknown — GPU-dominant match".
- Resolution missing on userRig: Default to report's or 1080p baseline.
- Very low/high perf outliers: Still surface top matches (community data can reveal driver/FG tricks that validation alone misses).
- 1% low / tweaks: Not in core scorer (future: parse notes for "FG enabled" bonus in factors).
- Laptop vs desktop: Future catalog field or notes; current wide tolerance via Phase 6.
- Multiple same-perf reports: Tie-break by helpful_votes or recency (existing sort stable).

---

## 7. Performance, Scale, Testing, and Risks

**Perf/Scalability:** As detailed in §4. Pure client scoring after bounded fetches. Buckets + indexes for future. Micro-benchmarks required.

**Testing Matrix (align Planner 4):**
- Unit: 12+ cases (exact perf match → 95+ score; 20% GPU diff → ~75; unknown rig → capped; RAM delta 32GB penalty; res 1080p vs 4K; top-N ordering verification vs legacy).
- Integration: CompatibilityChecker "what if" with known differing rigs; ReportCard badges with real perf distance; predict confidence higher on catalog-covered hardware.
- Real-data E2E: Submit varied rigs → predict on same game shows sensible top matches; consistency panel (when built) flags real outliers.
- Parity: All paths in mock + real + guest.
- Perf test: 5k synthetic reports → predict <15ms.

**Risks & Mitigations:**
- Score discontinuity on catalog updates: Versioned; display catalog v in UI; recompute on load.
- Over-reliance on catalog quality: Fallbacks + series blend during transition; community feedback loop via "report bad match".
- N=0 reports for rare rigs: Graceful "no close community matches yet — your data will help".
- Query cost on huge games: Bucketing + selective fetch (new helper).
- False "high similarity" on bad data: Composed with Phase 6 validation (high sim + implausible = moderator signal).

**Docs:** Update README, PHASE*, catalog header, "How we match community reports" education (synergize with Phase 6 "How we validate").

---

## 8. Exact Handoff for Implementation (Phase 7 Agent #1 Primary + Coordination)

**Dependencies:** Phase 6 catalog fully landed + types + re-exports + seeded data + validation wired.

**Priority Order:**
1. Catalog extensions + new pure similarity fns + types (core unblocker).
2. Update predict*/calculate* in mock-data + data.ts re-exports + async paths.
3. Wire into ReportCard (richer display) + CompatibilityChecker (perf score + better predictions).
4. Game page + my-reports enhancements.
5. Bucketing helpers + optional query optimizations.
6. Unit tests + E2E extensions + benchmarks.
7. Docs + education strings.

**Deliverables:** Working enhanced similarity powering all existing surfaces with measurable improvement (e.g., 4070 user sees 4080/4070 Ti reports as top matches, not just "RTX 40"). Foundation for RigConsistencyPanel, cluster aggregates, "find similar rigs" global browser.

This completes the shift from "static model validation" (Phase 6) to "rich community data-driven hardware matching" (Phase 7 core). The engine is the heart of the original user requirement.

**References (Absolute Paths from Inspection):**
- Plans: All 5 in `C:\Users\taken\grokbuild\plans\` (MASTER + 4 planners).
- Core: `C:\Users\taken\grokbuild\lib\mock-data.ts:551-642` (old fns + predict), `lib\data.ts:592-617,1104-1111` (real async + reexports), `lib\types.ts:42-79,98-104` (models), `app\actions\reports.ts:66-151` (submit), `supabase\schema.sql:62-138` (reports + indexes + aliases), `components\report-card.tsx:23-124`, `components\compatibility-checker.tsx:148-174`, `app\games\[slug]\page.tsx:348-500`.
- Phase 6 synergy notes: planner-1 §7, planner-3 §7.

**Ready for user approval + spawn of Phase 7 implementation agents (worktree isolation recommended).**

— Phase 7 Planning Agent #1 (Similarity Algorithm & Matching Engine)
