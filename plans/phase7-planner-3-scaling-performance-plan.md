# Phase 7 Planner Agent #3: Performance, Scaling & Data Access for Community Similarity Engine

**Focus:** Data Access Strategy, Efficient Top-N Similarity Retrieval, Caching, Indexing, and Scalability for Hardware-Aware Report Matching Using `perfIndex` Distances  
**Date:** 2026-05-26  
**Context:** Post-Phase 6 hardware validation catalog (`lib/hardware-performance-catalog.ts` with `HardwarePerfEntry`, `perfIndex` ~0-100 normalized flagship=100, `GPU_CATALOG`/`CPU_CATALOG`, pure `getCanonicalHardware` / `getHardwarePerf`, normalization pipeline). The catalog enables a vastly superior similarity metric than the current crude `extractGpuSeries` + `getCpuTier` + RAM heuristics in `lib/mock-data.ts:calculateSimilarity`.  

**Core Problem (at scale):** Community similarity ("find reports from rigs like mine") powers `predictForUserRigFromReports`, `CompatibilityChecker`, `ReportCard` similarity badges, and future "community like you" surfaces. Current implementation (detailed below) performs full-table-per-game scans + in-memory O(N) scoring for every prediction. With hundreds-to-thousands of reports per popular game (real Supabase growth), this becomes bandwidth-, latency-, and CPU-expensive. Both mock (small in-memory) and real (RLS-filtered Supabase) paths must remain fast, correct, and parity-perfect.

**Goal:** Design and specify an efficient, production-grade data access layer + algorithms for top-N (typically 5) most similar reports to a given `UserPC` (using `perfIndex` Euclidean / weighted Manhattan distances on GPU+CPU + contextual factors). Support both modes without breaking existing RLS, data adapter (`USE_REAL`), pure functions, or anon/auth parity. Provide clear migration path for existing reports.

This plan is coordinated with Phase 6 planners (especially Planner 1 §7 "Improves prediction/similarity" note, which calls for perf bonus in `calculateSimilarity`). It assumes Phase 6 static catalog + (Phase 6.2) `hardware_performance` table are landed or landing in parallel. All recommendations preserve "static catalog for hot paths" invariant.

---

## 1. Executive Summary & Key Architectural Decisions

**Current State (Pre-Phase 7) Analysis (from direct inspection of `lib/data.ts`, `lib/mock-data.ts`, `app/actions/reports.ts`, `app/games/[slug]/page.tsx`, `components/compatibility-checker.tsx`, `components/report-card.tsx`, `supabase/schema.sql`):**

- **Query patterns for reports:**
  - `getReportsForGame(gameId, filters?)` / `getReportsForGameAsync`: `supabase.from('reports').select('*').eq('game_id', ...).order('created_at', {desc})` (no LIMIT in core path; global variants cap at 200-300). Then client-side `filterReports` (pure, in mock). RLS auto-filters to `status='approved'` for public/anon; mods see all via role policy.
  - `predictForUserRigAsync`: Fetches *all* game reports (same query), then delegates to pure `predictForUserRigFromReports`.
  - `computeGameStatsAsync`, game detail page RQ: same full unfiltered fetch + client filter/agg.
  - Actions (`submitReportAction`): Auth + game lookup + rate/dup (on raw strings) + insert. No perf denorm yet.
  - Indexes exist: `idx_reports_game_created` (game_id, created_at DESC), `idx_reports_game_tier`, lower(gpu/cpu), resolution, partial on approved status. Good for current filters but not numeric perf distance.

- **Existing similarity (crude, O(N) full scan):**
  - `calculateSimilarity(report, userRig)`: base 50 + series match (RTX 40 etc via regex heuristics) +30/10, CPU tier match +15/5, RAM diff buckets +10/5. Max 100. No `perfIndex`, no canonicals, string-based only. Exported/re-exported via `lib/data.ts`.
  - `predictForUserRigFromReports(userPC, gameReports)`: scores *every* report via map, sorts desc, takes top 5 for `matchingReports`, derives tier/conf/explanation from their avg FPS. Used by checker (per selected game), prediction RQ hook, game page indirect via cards.
  - Call sites: ReportCard (per-card badge if >65%), CompatibilityChecker (recomputes on rig/game change via async fetches), game detail (passes `myRig` to cards), `lib/data.ts` reexports + hooks (`usePrediction` keys on full userPC object).

- **Hardware catalog (Phase 6):** Introduces relative `perfIndex` (e.g. 4090=100, 4070≈70.6), `getCanonicalHardware(raw)` + `getHardwarePerf`, rig scoring helpers (GPU 70-80% weight recommended). Static TS primary (O(1) map lookup, client+server safe, anon parity, zero cost). Future `hardware_performance` table (PK canonical, perf_index, vendor/series, public RLS SELECT) for admin overrides/audit. Normalization reuses/enhances alias logic + `sanitizeFullName`.

- **Parity & adapter invariants (critical):** `USE_REAL` branches in `lib/data.ts` (with safe mock fallbacks + warnings). All pure scoring stays in mock (or dedicated module) and is reused by real paths after fetch. RLS respected (no service_role in user paths). localStorage guests + anon Supabase users + auth users identical behavior.

- **Scale risks today:** At 500-2000 reports/game (realistic for popular titles post-growth), every checker load / prediction / page view pulls KB-MB of JSON + JS sorts. No server-side pruning. RQ caches exact (userPC, gameId) for 5min but misses "similar rigs" and re-fetches on any rig tweak. No perf denorm → repeated expensive canonical+lookup per report per call. Text indexes on gpu/cpu help filters but not distance ordering.

**Recommended Architecture (unanimous with Phase 6 spirit):**

- **Primary hot path:** Enhanced pure `calculateHardwareAwareSimilarity` (or evolved `calculateSimilarity`) in a new/shared module (e.g. co-locate or `lib/similarity.ts`). Uses catalog for `perfIndex` deltas as dominant signal + secondary factors (res, preset, ram). O(1) per report.
- **Data model evolution:** Denormalize `gpu_perf_index`, `cpu_perf_index`, `canonical_gpu`, `canonical_cpu` (nullable numeric/text) onto `reports` rows at insert time (computed via catalog in `submitReportAction`). Backfill script for history. Enables indexed range queries + SQL distance.
- **Retrieval strategy (hybrid, pragmatic for Supabase/PostgREST limits):** 
  - Specialized `getTopSimilarReportsAsync(userPC, gameId, limit=5)` (or internal to prediction) that:
    - Resolves user rig perf scores (static catalog, fast).
    - Fetches a bounded *candidate set* (e.g. recent N + perf-bucket range filter using new indexes/columns; or simple recent 300-500).
    - Delegates candidate scoring + top-N to the *same pure function* (predict path unchanged in shape).
  - Optional: Postgres RPC `find_similar_reports` (plpgsql, SECURITY DEFINER, uses stored perf cols for ORDER BY abs(gpu_pi - p_user_gpu) * w + ...) for true server-side top-N when candidate pruning insufficient. Returns limited rows (RLS applies via SECURITY DEFINER care or view).
- **Caching:** Extend existing RQ (smarter keys via perf-bucket hash of rig; SWR for popular game report lists). Server-side (Next.js `unstable_cache` or in-adapter TTL memo for report lists per game). Bucketed pre-aggregates optional for ultra-scale (avg FPS per perf-bucket per game).
- **Mock vs Real:** Mock = full scan (data tiny). Real = candidate pruning + pure scoring (or RPC). Adapter hides all; parity via shared pure fn + catalog.
- **Tradeoffs:** Exact top-N (accurate, simple) vs. approximate (fast, fixed-cost queries, "good enough" for UX). Favor approx + refinement for N>1000. Accuracy preserved for practical purposes because perf distance dominates and users tolerate near-matches.
- **No breakage:** Existing `getReportsForGameAsync(..., filters)` unchanged. Prediction surfaces keep returning same `PredictionResult` shape. RLS unchanged (new columns public-readable when row is).

**Phasing (aligned with Phase 6 rollout):**
- Phase 7.1 (MVP, with Phase 6.1 catalog): Enhance pure similarity fn with perf bonuses; wire into existing paths (minor perf win immediately). Denorm columns + insert-time computation (no backfill yet).
- Phase 7.2: Candidate pruning in async paths + indexes + backfill script + optional RPC. Full `getTopSimilar...` adapter entrypoint. Cache tuning. Admin visibility.
- Phase 7.3 (future): Bucketed materialized summaries, advanced approx NN (e.g. via pgvector if perf vectors grow), per-game learned weights.

**Deliverables:** This plan + coordinated changes across ~8-12 files. Zero new runtime deps. Full test matrix (mock/real, small/large N, unknown hardware, anon parity).

---

## 2. Detailed Current-State Query & Similarity Flow (with Perf Impact)

**Report fetch paths (real mode example):**
```ts
// lib/data.ts:374
const { data } = await supabase.from('reports')
  .select('*')
  .eq('game_id', gameId)
  .order('created_at', { ascending: false });
// Then (optional) filterReports + sort. No perf columns today.
```

**Similarity flow (predict path):**
1. `predictForUserRigAsync` → full game reports fetch.
2. `predictForUserRigFromReports` → `scored = gameReports.map(r => ({r, score: calculateSimilarity(r, userPC)}))` → sort → slice(5).
3. UI: ReportCards receive `userRig` and recompute per-card (dupe work, but cheap today).

**Problems at scale (hundreds+ reports):**
- Network: Every prediction/ page view / rig change downloads full report set (many columns: notes, tweaks, etc.).
- CPU/JS: Full map + sort in main thread (or server action if moved).
- Repeated work: Canonical + perf lookup (future catalog cost, even if O(1)) per report per user interaction.
- Cache inefficiency: RQ keys on full `userPC` object (exact match only); no sharing across "nearby" rigs.
- No server pruning: PostgREST can't easily "ORDER BY perf_distance LIMIT 5" without custom RPC or wide fetches.

**Phase 6 synergy (perfIndex distances):**
- User rig + report rig → resolve both to (gpuPi, cpuPi) via catalog (graceful fallback for unknowns: mid-range 45-55 + wide sim penalty).
- Distance example (to be codified):
  ```ts
  const gpuDist = Math.abs(gpuPiReport - gpuPiUser);
  const cpuDist = Math.abs(cpuPiReport - cpuPiUser) * 0.4; // lower weight
  const resPenalty = resolutionMismatch ? 8 : 0;
  const ramPenalty = Math.min(12, Math.abs(ramR - ramU) / 4);
  const presetBonus = presetMatch ? -5 : 0;
  const base = 100 - (gpuDist * 0.9 + cpuDist * 0.35 + resPenalty + ramPenalty + presetBonus);
  ```
- Bonus for helpful_votes, recency (soft). This replaces/enhances series heuristics (which become secondary or deprecated).

---

## 3. Recommended Data Model & Schema Changes

**New columns on `reports` (additive, non-breaking):**
```sql
-- In supabase/schema.sql migration (or direct editor)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS canonical_gpu text,
  ADD COLUMN IF NOT EXISTS canonical_cpu text,
  ADD COLUMN IF NOT EXISTS gpu_perf_index numeric(6,2),
  ADD COLUMN IF NOT EXISTS cpu_perf_index numeric(6,2);

-- Optional but recommended for bucket pruning (tiny cardinality)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS gpu_perf_bucket smallint,  -- e.g. floor(gpu_perf_index / 5) * 5  (0,5,10,...,100)
  ADD COLUMN IF NOT EXISTS cpu_perf_bucket smallint;

COMMENT ON COLUMN reports.gpu_perf_index IS 'Denormalized from hardware-performance-catalog at insert time (or backfill). NULL = unknown hardware at time of insert. Enables fast distance queries + indexes.';
```

**Indexes (critical for pruning + ORDER BY perf distance):**
```sql
CREATE INDEX IF NOT EXISTS idx_reports_game_gpu_pi ON reports (game_id, gpu_perf_index) WHERE gpu_perf_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_game_cpu_pi ON reports (game_id, cpu_perf_index) WHERE cpu_perf_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_game_perf_buckets ON reports (game_id, gpu_perf_bucket, cpu_perf_bucket) WHERE status = 'approved';

-- Existing lower(gpu) etc remain useful for text filters.
-- Partial approved index already good; extend if needed.
```

**hardware_performance table (from Phase 6 Planner 1, assumed or co-landed):**
- Public readable (RLS SELECT true) for admin + future direct lookup if we avoid full denorm.
- But for hot similarity: prefer denorm numbers on reports (no join, indexable, stable snapshot at report time). Catalog static still source-of-truth for *new* computations.

**Migration / Backfill considerations:**
- Columns nullable → old rows unaffected (similarity falls back to legacy crude logic or mid-perf defaults).
- Backfill script: `scripts/backfill-report-perf-indices.ts` (protected, modeled on `triggerIngestionAction` + admin role check in `app/actions/reports.ts`).
  - Loads batches (e.g. 500 rows via cursor or offset + WHERE gpu_perf_index IS NULL).
  - For each: `const g = getCanonicalHardware(row.gpu); const entry = getHardwarePerf(g);` (import catalog; server-safe).
  - UPDATE set the four columns + buckets.
  - Idempotent, resumable, logged. Run once via admin UI button (new "Backfill Perf Indices" in Performance Catalog tab or dedicated).
  - For very large tables: do in background job or multiple runs; monitor with new admin tile "Reports with perf denorm: X%".
- On new submits (Phase 6 + 7): In `submitReportAction` (after dup check, before/after validation), resolve canonicals + perf (reuse Phase 6 normalization), include in insertPayload. Same logic for any future `submit_report` RPC.
- Catalog version snapshot? Optional `catalog_version_used` column on report for audit (future).

**RLS impact:** None. New columns inherit row visibility (approved policy or mod role policy). Public can see perf numbers for approved reports (desired for transparency / future client-side experiments).

---

## 4. Efficient Algorithms & Data Structures for Top-N

**Core distance / scoring function (pure, versioned, in catalog or new `lib/similarity.ts`):**
- Evolve `calculateSimilarity` → `calculateHardwareAwareSimilarity(report: Report | {gpu, cpu, ram, ...}, userRig: UserPC, catalogVersion?: string): number`.
- Or keep name and enhance internally (backward compat for existing call sites).
- Inside: 
  1. Resolve `userGpuPi = getHardwarePerf(userRig.gpu)?.perfIndex ?? FALLBACK`.
  2. Same for report (prefer denormed `report.gpu_perf_index ?? lookup(raw)`).
  3. Weighted distance (constants in catalog for tuning; start GPU 0.85, CPU 0.3, etc.).
  4. Context penalties/bonuses (resolution closeness, preset, ram, recency decay, helpful_votes / 10).
  5. Clamp 0-100. Unknown hardware: lower max score + note.
- Expose `computeRigPerfScore(rig): {gpuPi, cpuPi, combined: number}` for bucket keys / caching.

**Top-N retrieval strategies (progressive complexity):**

1. **Baseline (Phase 7.1, immediate win):** Enhance pure scorer with perf deltas. All existing paths unchanged. Perf win from better ranking (not speed). Unknowns use mid fallback. Works instantly in mock + real (after insert denorm).

2. **Candidate pruning (recommended default for real mode, Phase 7.2):**
   - In `predictForUserRigAsync` / new helper: 
     - Compute user bucket(s) (e.g. userGpuBucket ±10-15 points).
     - Query 1: recent approved for game (LIMIT 250, uses existing idx).
     - Query 2 (parallel if indexed): reports in same/adjacent perf_buckets for game (LIMIT 150).
     - Union + dedupe in JS → candidate set (typically <400 even at 5k total).
     - Run pure `predictForUserRigFromReports` (or dedicated `scoreAndRankTopN(candidates, userPC, 5)`) on the small set.
   - Result: bounded network/CPU. High recall for true top matches (perf is strong signal; most similar live near the user's perf band).
   - Fallback: if candidate set < 3×limit, widen or fall back to full recent.

3. **Server-side exact top-N via Postgres function (optional power tool):**
   ```sql
   -- In schema.sql (or migration)
   CREATE OR REPLACE FUNCTION public.find_top_similar_reports(
     p_game_id uuid,
     p_user_gpu_pi numeric,
     p_user_cpu_pi numeric,
     p_limit int DEFAULT 5
   ) RETURNS SETOF reports
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
   BEGIN
     RETURN QUERY
     SELECT r.* FROM reports r
     WHERE r.game_id = p_game_id
       AND r.status = 'approved'  -- RLS-equivalent; caller can relax for mods
     ORDER BY 
       ( ABS(COALESCE(r.gpu_perf_index, 48) - p_user_gpu_pi) * 0.85 +
         ABS(COALESCE(r.cpu_perf_index, 52) - p_user_cpu_pi) * 0.3 +
         -- + context terms if denormed or cheap
         (CASE WHEN r.helpful_votes > 10 THEN -2 ELSE 0 END)
       ) ASC,
       r.created_at DESC
     LIMIT p_limit;
   END;
   $$;
   GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;
   ```
   - Call from adapter (real mode only): `supabase.rpc('find_top_similar_reports', {p_game_id, p_user_gpu_pi: userScore.gpu, ...})`.
   - Pros: True server LIMIT + ORDER (minimal rows over wire). Cons: More complex (must mirror all scoring factors exactly or accept approx), harder parity testing, SECURITY DEFINER needs care to not bypass RLS unintentionally (use explicit status filter or views).
   - Recommendation: Implement as optimization behind flag or for "exact mode"; keep JS pure as source of truth for scoring formula.

4. **Advanced (Phase 7.3+):** 
   - Pre-materialized "rig archetype" summaries per game (table `game_perf_buckets`: game_id, gpu_bucket, cpu_bucket, sample_report_ids jsonb, avg_fps, count). Query 3-5 buckets around user → hydrate actual reports (or store lightweight previews).
   - If vectors grow: pgvector on (gpu_pi, cpu_pi) + `<->` distance (but overkill for 2D scalar + few factors).
   - Sampling: for ultra-large games, stratified sample + exact on sample.

**Pure function location:** Move/enhance scoring logic out of `mock-data.ts` into `lib/hardware-performance-catalog.ts` (or dedicated `lib/similarity.ts` that imports catalog). Re-export via `data.ts`. This makes it first-class with validation code.

---

## 5. Caching Strategies

**Existing (reuse & extend):**
- React Query in `lib/data.ts`: `usePrediction` (key `['prediction', gameId, userPC]` — note: object key serializes reasonably), staleTime 5min, gc 30min. `useReportsForGame` etc. share report lists.
- Per-game report lists already cached (good for multiple checkers on same game).

**Enhancements for Phase 7:**
- **Rig bucketing for cache keys:** In `usePrediction` (and internal), derive stable key segment: `perfBucketKey = `${Math.round(userGpuPi/5)*5}-${Math.round(userCpuPi/5)*5}``. Query key: `['prediction', gameId, perfBucketKey, userRigHash?]` . This allows SWR sharing of "nearby rig" results (with background revalidate on exact). Pure scorer still run for final ranking.
- **Report list caching (server/edge):** In real-mode `getReportsForGameAsync` (or new internal `getGameReportsForSimilarity`), wrap the Supabase fetch in `unstable_cache` (Next.js) with revalidate 60-300s for popular games (keyed by gameId + status filter). Reduces origin DB load.
- **Adapter-level short TTL memo (Node memory, per instance):** For hot games, memoize recent full/candidate report arrays (Map<gameId, {ts, reports}>, max 50 entries, 2min TTL). Serverless cold starts lose it, but warm instances benefit. Use only for similarity paths.
- **Prediction result caching beyond RQ:** Optional lightweight in-memory for anon session or per popular rig archetypes.
- **Invalidation:** On new approved report (via webhook/future trigger or manual), invalidate game reports + predictions for that game (broad but rare). Admin moderation status change → targeted invalidate.
- **Tradeoff:** Stale similar-reports lists acceptable (community data not real-time critical); 5-15min freshness fine.

**No external cache (Redis etc.)** unless scale demands (current stack is Supabase + Next.js; keep simple).

---

## 6. Mock Mode vs Real Supabase Performance Characteristics

- **Mock (`!USE_REAL`):** In-memory `GAMES` + `REPORTS` arrays (seeded small, <200?). Full scan + pure scoring is <1ms. No change needed except enhanced scorer. Perfect for dev/demo/offline/anon guests (localStorage reports also small).
- **Real (`USE_REAL`):** 
  - RLS-enforced SELECT (anon/auth see only approved; cost is index scan on game_id + status partial).
  - With pruning: 1-2 indexed range/limit queries → few hundred rows max → fast (<100ms typical) + tiny wire.
  - RPC path (if used): single roundtrip, minimal payload.
  - Fallbacks in adapter: on any error (incl. new columns missing during migration), fall back to legacy full fetch + old scorer (safe, logged).
- **Parity guarantees:** Same `PredictionResult` + `matchingReports` order (within scoring determinism). Same confidence/explanation logic. Catalog version in result (future field) identical. Unknown hardware path identical.
- **Testing:** Matrix in Phase 6 style (small N mock, large synthetic in real via seed, perf timing assertions in unit tests for scorer <1ms/1000 calls).

**Performance targets (to codify in plan + tests):**
- Prediction end-to-end (real, 2k reports game): <250ms P95.
- Scorer: <5ms for 500 candidates.
- DB query for candidates: uses indexes, <50ms.

---

## 7. Trade-offs: Accuracy vs Speed, Simplicity vs Power

| Approach                  | Accuracy (top-N recall) | Speed (at 5k reports) | Complexity / Maintenance | Parity Ease | Recommendation |
|---------------------------|--------------------------|-----------------------|---------------------------|-------------|----------------|
| Full scan + pure sort (current) | 100% exact | Slow (O(N) + bandwidth) | Low | Excellent | Keep as fallback only |
| Perf-enhanced scorer only (no fetch change) | Same as before (better ranking) | Same as current | Very low | Perfect | Phase 7.1 MVP |
| Candidate pruning (recent + bucket range) + pure | ~92-98% (perf-dominant signal) | Fixed cost, excellent | Medium (2 queries + union) | Excellent (pure fn) | **Primary for Phase 7.2** |
| Postgres RPC ORDER BY distance LIMIT | 100% (or near if factors approximated) | Best (server prunes) | High (mirror formula in SQL + testing) | Good (needs dual impl) | Optional optimization |
| Bucketed materialized + samples | 85-95% (good enough) | Best for ultra-scale | Highest (new tables, refresh jobs) | Medium | Phase 7.3+ only |
| Client-only with full cached reports | High | Depends on cache hit | Low | High | Augment RQ |

**Chosen path:** Hybrid pruning + pure JS scorer as default (best balance for this stack/size). RPC as future escape hatch. Always document "approximate but excellent in practice" for any non-exact.

**Other tradeoffs:**
- Denorm vs join: Denorm wins (speed, indexability, snapshot stability). Minor storage (4 nums + 2 text per row, negligible).
- Storing perf at insert time: "Report time" snapshot vs live catalog (preferred: historical reports shouldn't shift if catalog refreshes).
- Exposing perf columns publicly: Yes (transparency, powers client experiments, future "rig score" badges).

---

## 8. Integration with Existing RLS, Data Adapter, and Phase 6 Catalog

- **RLS:** No policy changes. New columns visible exactly when row is (approved or mod override). RPC (if added) must respect or explicitly filter status.
- **Data adapter (`lib/data.ts`):** 
  - Add `getTopSimilarReportsForGameAsync?(userPC, gameId, limit?)` (real: pruning query or rpc; mock: full + slice).
  - Or evolve `predictForUserRigAsync` internally to use smart fetch when possible.
  - Re-export new/updated pure: `calculateHardwareAwareSimilarity`, `computeRigPerfScore`.
  - Update `predictForUserRigFromReports` JSDoc + optional `options` for candidate mode.
  - Preserve all existing exports/signatures.
- **Catalog interaction:** Import `{ getCanonicalHardware, getHardwarePerf, CATALOG_VERSION, FALLBACK_... }` from catalog (or via data reexport). Normalization logic shared with Phase 6 validation (avoid duplication; consider `lib/normalize-hardware.ts` as common home if not already).
- **Submit hot path:** Extend `submitReportAction` (post Phase 6 validation) to compute + store perf denorms. Use same pure helpers.
- **Admin:** Surface "% reports with perf denorm" + "Run backfill" button (reuses admin action pattern). Performance Catalog tab (Phase 6) can link to similarity tuning notes.
- **No impact on:** Tier calc (still FPS-only), validation bands, upvoting, existing filters, ReportCard owner-gated features (Phase 6).

---

## 9. Implementation Outline & File Changes (High-Level Diffs)

**New / Major:**
- `lib/similarity.ts` (or extend `hardware-performance-catalog.ts`): `calculateHardwareAwareSimilarity`, `computeRigPerfScore`, constants (weights, fallbacks, bucket fn), JSDoc with formula. Unit tests.
- `scripts/backfill-report-perf-indices.ts` (protected admin action wrapper).

**Modified:**
- `lib/types.ts`: Extend `Report` (optional new fields), `PredictionResult` (optional `catalogVersionUsed?`), add `RigPerfScore` interface if useful. `HardwarePerfEntry` already from Phase 6.
- `supabase/schema.sql`: Column + index + (optional) RPC additions + comments "Phase 7 similarity scaling".
- `lib/data.ts`: 
  - New async `getTopSimilarReportsAsync` (or internal candidate fetcher).
  - Update `predictForUserRigAsync` to optionally use pruning.
  - Re-exports + hooks (smarter keys).
  - Warnings for legacy paths.
- `lib/mock-data.ts`: 
  - Enhance or delegate `calculateSimilarity` / add `calculateHardwareAwareSimilarity` (for parity).
  - Keep old for legacy callers during transition.
  - Synthetic large report generators for perf tests?
- `app/actions/reports.ts`: In `submitReportAction` (and `getReportByIdForMod` if needed): resolve + store perf denorms using catalog import. Update map if necessary.
- `app/games/[slug]/page.tsx` + `components/compatibility-checker.tsx` + `components/report-card.tsx`: Minor — pass/use new similarity if API changes; otherwise transparent. Optionally surface "powered by perfIndex catalog vX".
- `app/admin/page.tsx`: New stats / backfill controls in Performance Catalog or Overview tab (Phase 6 surface).
- `plans/phase7-planner-3-scaling-performance-plan.md` (this doc).

**Optional nice-to-haves (Phase 7.2):**
- `components/similarity-debug.tsx` (admin only, shows distances).
- Expanded RQ query keys + devtools visibility.

**Order:** Catalog/denorm insert first (unblocks scoring), then adapter pruning, then backfill + admin, then UI polish.

**Testing & verification (must include):**
- Unit: scorer with known perf pairs (exact distances), bucket fn, unknown fallback.
- Integration: mock large synthetic reports (500+), assert top-N stable + fast; real-mode E2E via existing scripts (seed + submit + predict, check denorm columns).
- Parity matrix: identical results mock vs real (small data), graceful degradation.
- Perf microbench: `assert(scorerTime(1000 reports) < 10ms)`.
- RLS: anon sees only approved + their perf cols.
- Migration: dry-run backfill script on copy of prod-like data.
- Follows Phase 5/6 verification culture (checklists, swarm prompts extension).

---

## 10. Risks, Mitigations, Rollout

**Risks:**
- Backfill load / correctness on historical data (stale catalog at report time vs now): Mitigate with "as-of insert" semantics + audit log of version used.
- Formula drift between JS pure and any SQL RPC: Mitigate by making pure fn the spec; SQL is approx only.
- Cache staleness causing "weird" similar reports after new submissions: 5min RQ + explicit invalidation on submit success (existing pattern).
- Index bloat or query planner surprises on new columns: Monitor via Supabase dashboard; partial indexes + WHERE NOT NULL help.
- Over-pruning misses good matches (rare hardware in odd buckets): Widen buckets or always include top recent + random sample.
- Anon/localStorage guests: No change (small data, full scan fine).

**Rollout (dark → soft → full, per Phase 6 Planner 4 culture):**
- Behind existing `NEXT_PUBLIC_USE_REAL_DATA` + new `NEXT_PUBLIC_SIMILARITY_PRUNING` or internal flags.
- Dark: log distances + candidate sizes (no UI change).
- Soft: enable pruning for predictions only.
- Full: all surfaces + backfill + admin tools.
- Monitoring: new admin tile "Avg reports fetched per prediction", "Similarity compute p95", "Backfill progress".

**Observability:** Console + (future Sentry) timings in adapter paths. Admin "Similarity Health" section.

---

## 11. Open Questions for Implementer / Orchestrator (to resolve in execution)

- Exact weight constants + penalty values (tune post real data + A/B on confidence/engagement)?
- Do we store `catalog_version` per report for perf snapshot (recommended for audit)?
- Priority of RPC vs pure+prune (RPC only if pruning insufficient in prod)?
- Future: per-game difficulty weighting in similarity (synergizes with catalog game factors)?
- Should `getReportsForGameAsync` grow an optional `forSimilarity?: boolean` hint for internal optimization?

---

## 12. References & Coordination

- Phase 6: `plans/MASTER-Hardware-Validation-Implementation-Plan.md`, `planner-1-hardware-catalog-plan.md` (esp. §7 similarity note, data model, seeding), `planner-2...`, `planner-3...` (UX surfaces that consume similarity), `planner-4...` (admin + rollout).
- Current code: `lib/{data, mock-data, types}.ts`, `app/actions/reports.ts`, `supabase/schema.sql`, game detail + checker + report-card components, RQ hooks.
- Post-Phase 6 invariants: Static catalog primary, pure fns everywhere, full anon/auth/real/mock parity, additive not replacement.
- Future synergy: Once perf denormed, validation + similarity share normalization; possible "rig health vs community" surfaces.

**This plan delivers fast, scalable, accurate community similarity while preserving every existing guarantee and architectural principle of the project.**

Ready for review + coordination with other Phase 7 planners (if any) and implementers.

— Phase 7 Planning Agent #3 (Performance, Scaling & Data Access)