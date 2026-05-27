# Hardware Validation Planner Agent #1: Hardware Performance Catalog Implementation Plan

**Focus:** Data & Catalog System for Hardware-Aware Performance Validation  
**Date:** 2026-05-26  
**Context:** RunDB (Next.js 16 + React 19 + Supabase real-data via `NEXT_PUBLIC_USE_REAL_DATA`). Core gap: No validation that submitted `Report.avgFps` (and tier) is plausible for the `cpu`/`gpu`/`ram` claimed *in the same report*. Existing `predictForUserRigFromReports` + `calculateSimilarity` (lib/mock-data.ts) only does post-hoc similarity to *other* reports.  
**Goal:** When hardware is entered (profile-rig-editor, compatibility-checker, submit-report-dialog) or submitted (submitReportAction), validate claimed performance against realistic expectations derived from a **Hardware Performance Catalog**. Mismatches → client warnings, server-side flags (`status='flagged'`), blocks on egregious cases. Works identically for Supabase-auth users (including anonymous) and localStorage guests.

This plan is concrete, production-minded, and phased. All paths verified against current codebase via inspection of `lib/types.ts`, `supabase/schema.sql`, `lib/mock-data.ts`, `lib/data.ts`, `app/actions/reports.ts`, `components/submit-report-dialog.tsx`, `components/profile-rig-editor.tsx`, `components/compatibility-checker.tsx`, `app/admin/page.tsx`, and related.

---

## 1. Research Summary & Recommendation: Static Curated Catalog vs. External APIs

### Data Sources Evaluated
- **TechPowerUp (TPU) GPU Relative Performance**: Best-in-class game-averaged relative % (raster + RT splits in recent test beds). Updated with new reviews (RTX 50-series covered 2025+). No free public API/CSV/JSON bulk export. Commercial DB licensing + REST API available (enterprise pricing). Public site pages + reviews contain tables. Scraping possible (JS-heavy, bot-protected; TOS risk for automation).
- **PassMark (videocardbenchmark.net / cpubenchmark.net)**: Excellent public "mega pages" (GPU G3D Mark, CPU Mark) — sortable tables of *thousands* of entries with averaged relative scores from >1M submissions. Sample detailed CSVs available. Licensed full dumps expensive (~$1k+). Scores are strong proxies for 3D/gaming perf (G3D correlates well with real FPS). Updated daily. Public data sufficient for curation.
- **Other high-quality public/scrapable**:
  - GitHub: `RightNow-AI/RightNow-GPU-Database` (ready static `all-gpus.json` + per-vendor from TPU/dbgpu).
  - gpucheck.com scrapers (direct FPS per game + hardware combos; Kaggle derivatives).
  - Notebookcheck scrapers (real measured FPS in many titles/resolutions).
  - Phoronix/OpenBenchmarking (high-quality Linux game FPS + full CPU+GPU+RAM).
  - gradedSystem PassMark CSVs on GH.
- **UserBenchmark / others**: Avoid or use cautiously (known methodology controversies).

### Pros/Cons + Recommendation
**Static curated JSON/TS dataset (STRONGLY RECOMMENDED for MVP + Phase 1-2)**:
- **Pros**: Zero runtime cost/latency/keys; works fully offline + for anonymous/localStorage users; fully version-controllable in git (easy PR review for RTX 50xx additions); deterministic & auditable; no legal scraping exposure at runtime; immediate integration; easy to seed 50-80 GPUs + 30+ CPUs from public PassMark mega pages + TPU cross-refs.
- **Cons**: Manual refresh cadence for new hardware (mitigated by admin tooling + curator notes).
- **Legal/Freshness**: Curate snapshots from *publicly visible charts* (mega pages + review tables) with clear attribution in file header. Low risk for non-commercial internal validation use (not redistributing data). Freshness: update quarterly or on major launches; initial seed covers 95%+ of current user reports.
- **Cost**: $0.

**External API / live scraping (Phase 3 only, optional fallback)**:
- **Pros**: Auto-fresh (new cards appear fast).
- **Cons**: Rate limits, potential TOS violations (especially TPU), API cost or fragility, network dependency (breaks anon/offline), maintenance burden, privacy. PassMark/TPU have no generous free tiers for perf data.
- **Recommendation**: Defer entirely. Use static as source-of-truth. Future "refresh" = curator runs public scraper locally → produces versioned JSON patch → admin imports or PRs the TS update. Never runtime scrape.

**Final Rec**: Pure static `lib/hardware-performance-catalog.ts` (typed, versioned) as **primary**. No external calls in hot paths (submit/validation). DB table added for future admin overrides + audit, but catalog logic prefers static for speed/simplicity. This matches the existing Phase 4 alias pattern (static defaults + localStorage overrides in mock).

---

## 2. Proposed Data Model

### Core Types (add to `lib/types.ts`)
```ts
export interface HardwarePerfEntry {
  canonical: string;           // Must match HardwareAlias.canonical exactly (e.g. "NVIDIA GeForce RTX 4090")
  componentType: 'gpu' | 'cpu';
  perfIndex: number;           // Relative score. Normalize so flagship ~100.0 (e.g. PassMark G3D / 380.72 for GPUs). Use ratios in calculations.
  vendor: string;              // 'NVIDIA' | 'AMD' | 'Intel'
  series: string;              // 'RTX 40' | 'RDNA3' | 'Zen 4' | 'Raptor Lake' etc.
  minRamGBRecommended?: number;
  notes?: string;              // "G3D ~38072 (PassMark May 2026 avg, 21k+ samples). Excellent RT/4K."
  source: string;              // "PassMark videocardbenchmark.net G3D Mark (2026-05 snapshot) + TPU relative cross-ref"
  lastUpdated: string;         // ISO date
}

export interface HardwareValidationResult {
  isPlausible: boolean;
  severity: 'ok' | 'warn' | 'block';
  confidence: number;          // 0-1
  expectedRange: { min: number; max: number; expected: number };
  submittedFps: number;
  deviationRatio: number;      // submitted / expected
  canonicalGpu?: string;
  canonicalCpu?: string;
  reason?: string;             // Human + machine readable for moderatorNotes / toasts
  catalogVersion: string;
}

export interface ResolutionFactors {
  [res: string]: number;       // e.g. '2560x1440': 0.72 (relative to 1080p baseline)
}
```

### Catalog Structure (in `lib/hardware-performance-catalog.ts`)
- `export const CATALOG_VERSION = '2026.05.26-v1';`
- `export const GPU_CATALOG: Record<string, HardwarePerfEntry> = { ... };`
- `export const CPU_CATALOG: Record<string, HardwarePerfEntry> = { ... };`
- Supporting constants: `RESOLUTION_FACTORS`, `PRESET_FACTORS` (relative to 'High'), `GAME_DIFFICULTY_FACTORS` (per slug, tuned from known real benchmarks + current report averages; start conservative).
- Pure functions (no side effects, server + client safe):
  - `getCanonicalHardware(raw: string, aliases?: HardwareAlias[]): string | null`
  - `getHardwarePerf(canonicalOrRaw: string, aliases?: HardwareAlias[]): HardwarePerfEntry | null`
  - `estimateExpectedFps(...) : {expected: number, min: number, max: number}`
  - `validateHardwarePerformance(input): HardwareValidationResult`

**Why this model?**
- Relative `perfIndex` (ratio-based) is robust, resolution/preset/game independent at core.
- Scaling formula (detailed in code section): GPU-dominant (70-80% weight) + CPU + RAM floor + res/preset/game multipliers.
- Future-proof: Easy to add `perGameBaselines?: Record<string, number>` or separate `game_hardware_baselines` table in Phase 2/3 without breaking ratios.
- Combined rig score derivable on the fly for similarity improvements.

**Storage**:
- Primary: Static TS (fast lookup, typed, git history).
- DB (future): `hardware_performance` table (see schema below) for overrides + full admin CRUD in real mode. Static remains source of truth or seed.

---

## 3. Extending HardwareAlias → Full Catalog

- **Do NOT** overload `HardwareAlias` with perf scores (it is raw→canonical mapping, often many-to-1).
- **Keep separate**: `HardwareAlias` (existing) + new `HardwarePerfEntry` (canonical-keyed).
- **Pipeline synergy**: `normalizeToCanonical(raw)` reuses (or mirrors) alias lookup logic. When a canonical has no perf entry yet → graceful fallback (lenient validation + "unknown hardware" note).
- **Admin evolution**: Current `/admin` Hardware Aliases tab (CRUD via mock) will gain a sibling "Performance Catalog" tab. Future real migration: aliases table + performance table both become DB-backed (mirroring reports/profiles pattern).

---

## 4. Seeding Strategy (Initial 50-80 GPUs + 30+ CPUs)

**Target coverage** (covers vast majority of real gaming PCs 2022-2026):
- **GPUs (~65 entries)**: NVIDIA RTX 20/30/40/50 series (2060 → 5090, all common variants: Ti, Super, Ti Super). AMD RX 6600/6700/6800/6900 → 7800/7900/8900 XTX/XT. Intel Arc A380/A580/A750/A770. Focus on desktop; note laptop variants leniently.
- **CPUs (~35 entries)**: Intel Core i5/i7/i9 10xxx-14xxx + Ultra series; AMD Ryzen 5/7/9 3000-9000 (especially X3D gaming kings: 5800X3D, 7800X3D, 9800X3D).
- **Concrete normalization example** (use real PassMark numbers):
  - RTX 4090: perfIndex ≈ 100.0 (G3D ~38072 → divide by ~380.72)
  - RX 7900 XTX: ~82.5 (31420 / 380.72)
  - RTX 4070: ~70.6 (26900 / 380.72)
  - Lower cards scaled proportionally. Same for CPUs (use CPU Mark or gaming-focused single-thread proxies from public mega page).
- **Sources in every entry notes + file header**:
  ```
  // Curated May 2026 from:
  // - PassMark videocardbenchmark.net / GPU_mega_page.html + high_end_gpus (G3D Mark averages)
  // - cpubenchmark.net CPU mega page
  // - Cross-referenced TechPowerUp relative performance charts (public review tables)
  // Ratios preserved; absolute values not stored to avoid implying exact FPS.
  ```
- **Seeding process**:
  1. Curator (planner or maintainer) manually extracts top entries from public mega pages (5-10 min per batch).
  2. Populate TS object (use script helper later).
  3. Verify ratios vs known real-game FPS (e.g. 4090 Cyberpunk 1440p Ultra ~110-140 fps typical post-patches).
  4. Include `minRamGBRecommended` (16 for mid-high, 24-32 for 40/50-series heavy RT titles).
- **Fallbacks**: Unknown canonical → use average mid-range perfIndex (e.g. 45) + wide tolerance band + "catalog miss" flag for mods.
- **Versioning**: Bump `CATALOG_VERSION` + date on every edit. Expose in admin + validation results.

**Example entries** (abbreviated for plan; full list in implementation):
```ts
'NVIDIA GeForce RTX 4090': { canonical: '...', componentType: 'gpu', perfIndex: 100.0, vendor: 'NVIDIA', series: 'RTX 40', ... source: '...', lastUpdated: '2026-05-26' },
'AMD Ryzen 7 7800X3D': { ... perfIndex: 92.0 (gaming-adjusted), ... },
```

---

## 5. Normalization Pipeline (Raw User String → Alias → Canonical → Perf)

Pure, importable from anywhere (`lib/normalize-hardware.ts` or co-located in catalog file):

1. `sanitizeFullName(raw)` (existing).
2. Exact case-insensitive match against loaded `HardwareAlias` (current mock localStorage; future DB).
3. Fallback heuristics (built into catalog):
   - Common abbreviations ("4090", "7800x3d", "rx7900xtx").
   - Series extraction (reuse/enhance `extractGpuSeries` + new `extractCpuSeries` from mock-data).
4. Return canonical (or original sanitized if no match).
5. `getHardwarePerf(canonical)` → lookup in GPU_CATALOG or CPU_CATALOG (case-insensitive key match).

**Server Action consideration**: Aliases currently mock-only (localStorage). For real-mode validation in `submitReportAction`:
- Use static catalog canonicals + built-in common raw→canonical map as primary.
- Enhance alias lookup to be server-safe (static seed list of common aliases in catalog file, merged with any future DB aliases).
- Recommendation in rollout: Treat catalog as self-contained for MVP (duplicate a small authoritative alias map inside it).

---

## 6. DB Migration Path + Mock Fallback

### Schema Addition (`supabase/schema.sql`)
Append after `hardware_aliases` table:

```sql
-- Hardware Performance Catalog (Phase 6 / hardware validation)
-- Canonical-keyed relative performance. Static TS is source of truth for MVP;
-- this table enables future admin overrides, auditing, and per-game extensions.
CREATE TABLE hardware_performance (
  canonical text PRIMARY KEY,
  component_type text NOT NULL CHECK (component_type IN ('cpu', 'gpu')),
  perf_index numeric(8,2) NOT NULL,
  vendor text,
  series text,
  min_ram_gb_recommended integer,
  notes text,
  source text NOT NULL,
  last_updated timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hardware_perf_vendor ON hardware_performance (vendor);
CREATE INDEX idx_hardware_perf_type ON hardware_performance (component_type);

ALTER TABLE hardware_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hardware performance catalog is publicly readable" ON hardware_performance FOR SELECT USING (true);

-- Optional: future admin RPCs for bulk upsert from catalog version.
```

Run via Supabase SQL editor (idempotent with `CREATE TABLE IF NOT EXISTS` or separate migration note).

### Mock vs Real Paths
- **Always**: `lib/hardware-performance-catalog.ts` exports full static data + all pure functions. Works in demo + real.
- **lib/data.ts**:
  - Add `getHardwarePerformanceCatalog(): HardwarePerfEntry[]` (static for now).
  - `getHardwarePerf(...)`, `validateHardwarePerformance(...)` wrappers (forward to catalog; future: DB overrides).
  - Async variants for real-mode admin tools.
- **Seeding to DB** (optional, Phase 2+): `scripts/seed-hardware-catalog.ts` (protected via `triggerIngestionAction`-style admin Server Action). Idempotent upsert by `canonical`.
- **Overrides**: Later table can hold "admin adjusted" rows; query merges static + DB (DB wins on conflict for same canonical).
- **Aliases note**: Current aliases remain localStorage-only. Catalog MVP does **not** block on perfect alias match.

**Migration safety**: Add table non-breaking. Existing reports unaffected.

---

## 7. How Catalog Feeds Validation + Improves Existing Prediction

### Core Validation Function (MVP formula sketch — tune constants in code)
```ts
// Rough calibrated baseline: high-end rig at 1440p High ~90-110 fps "typical" modern title
const BASE_EXPECTED = 95;
const GPU_WEIGHT = 0.75;

function estimateExpectedFps(gameId, canonicalGpu, canonicalCpu, ram, resolution, preset) {
  const g = GPU_CATALOG[canonicalGpu]?.perfIndex ?? 48;
  const c = CPU_CATALOG[canonicalCpu]?.perfIndex ?? 55;
  const rigFactor = GPU_WEIGHT * (g / 100) + (1 - GPU_WEIGHT) * (c / 100);
  const resF = RESOLUTION_FACTORS[resolution] ?? 0.65;
  const presetF = PRESET_FACTORS[preset] ?? 1.0;
  const gameF = GAME_DIFFICULTY_FACTORS[gameId] ?? 0.92;
  const ramF = ram >= 32 ? 1.05 : ram >= 16 ? 1.0 : 0.85;

  const expected = BASE_EXPECTED * rigFactor * resF * presetF * gameF * ramF;
  return {
    expected: Math.round(expected),
    min: Math.round(expected * 0.48),   // Very wide for safety (OC, tweaks, patches, measurement error)
    max: Math.round(expected * 2.1),
  };
}
```
- `1% low` check: warn if `< 0.55 * avgFps` (unusually bad) or `> 0.92 * avgFps` (suspiciously perfect).
- Severity:
  - `ok`: inside [min, max]
  - `warn`: 0.3×expected < fps < min or max < fps < 2.8×expected → client warning + auto-flag on submit
  - `block`: fps < 0.3× or > 2.8× or absurd absolute (e.g. > 500 in heavy 4K title on mid hardware) → hard reject in action + clear error
- Confidence: based on catalog coverage (both GPU+CPU known?).

### Integration Points
- **Client (pre-submit)**: `submit-report-dialog.tsx` — on form submit or "Validate" button, run `validate...`, show nice warning banner/modal ("This 240 fps claim on an RTX 3060 at 4K Ultra is ~4.2× higher than expected... Possible typo / frame-gen / OC? Proceed anyway?"). Still allows submit (soft).
- **Server (authoritative)**: `app/actions/reports.ts` inside `submitReportAction` (after dup/rate checks, before insert):
  - Compute validation.
  - If `block`: `throw new Error('... unrealistic for this hardware. ...')` (extends existing anti-abuse).
  - If `warn`: set `status = 'flagged'`, append to `moderatorNotes` (or new structured field later): `Hardware validation (catalog v${ver}): ${reason}. Submitted ${avg} vs expected ${min}-${max}.`
  - Always proceed to insert (except block). Tier calc remains FPS-only (catalog is orthogonal).
- **RPC parity**: If `submit_report` RPC used later, mirror logic or call a new `validate_hardware_perf` helper (add to schema).
- **Improves prediction/similarity** (immediate win):
  - In `calculateSimilarity` (or new `calculateHardwareAwareSimilarity`): after canonical lookup, add `|gpuPerfReport - gpuPerfUser| < 15 ? +18 : ...` bonus.
  - `predictForUserRigFromReports`: prefer or boost reports whose hardware perf is close to user's.
  - Bonus: expose `getRigPerfScore(userPC)` for UI badges ("High-end rig score: 94").

All paths (profile save, checker "what if", submit) feed the same pure functions → identical behavior for anon/auth.

---

## 8. Exact Files & High-Level Changes

### New Files
1. **`lib/hardware-performance-catalog.ts`** (core ~250-350 LOC)
   - Constants, full seeded GPU_CATALOG + CPU_CATALOG (65+35 entries).
   - All pure helpers + `validateHardwarePerformance`.
   - Header with full sourcing + update instructions.
2. **`lib/normalize-hardware.ts`** (optional but recommended; ~80 LOC)
   - `normalizeToCanonical(raw, aliases?)`, `getHardwarePerf(...)`, helpers. Reuses/enhances `extractGpuSeries` logic from mock-data.
3. **`scripts/seed-hardware-catalog.ts`** (DB population helper, protected).
4. **`components/admin-performance-catalog-tab.tsx`** (or inline; reusable table + import JSON dialog for Phase 2 admin).
5. **`plans/planner-1-hardware-catalog-plan.md`** (this document).

### Modified Existing Files (high-level diffs)

- **`lib/types.ts`**:
  - Add `HardwarePerfEntry`, `HardwareValidationResult`, `ResolutionFactors` etc.
  - Optional: extend `SubmitReportInput` or add `validationContext` for future.

- **`lib/data.ts`**:
  - Import & re-export catalog functions (static-first).
  - Add `useHardwareCatalog` hook wrapper if desired (React Query for admin).
  - Keep `predictForUserRigFromReports` export; consider adding hardware-aware variant later.

- **`lib/mock-data.ts`** (minimal):
  - Optionally move/enhance `extractGpuSeries` + `getCpuTier` here or deprecate in favor of new normalize-hardware.
  - No major perf data changes (static lives in new dedicated file).

- **`app/actions/reports.ts`**:
  - Import validation.
  - Inside `submitReportAction` (after existing anti-abuse, before tier/insert):
    ```ts
    const validation = validateHardwarePerformance({ gameId: ..., cpu: input.cpu, ... avgFps });
    let finalStatus: ReportStatus = 'pending';
    let modNotes = input.notes ?? null; // or separate
    if (validation.severity === 'block') {
      throw new Error(`Reported performance (${validation.submittedFps} fps) is not plausible for ${validation.canonicalGpu || input.gpu} + ${validation.canonicalCpu || input.cpu}... Expected ~${validation.expectedRange.expected} (range ${min}-${max}). Please double-check your measurements or settings.`);
    }
    if (validation.severity === 'warn') {
      finalStatus = 'flagged';
      modNotes = (modNotes ? modNotes + ' | ' : '') + `AUTO: Hardware perf validation ${validation.severity} (v${validation.catalogVersion}): ${validation.reason}`;
    }
    // Then use finalStatus and modNotes in payload
    ```
  - Update `calculatePerformanceTier` comment to note catalog is separate.

- **`components/submit-report-dialog.tsx`**:
  - Import `validateHardwarePerformance` + types.
  - Before `await addUserReport`, run validation.
  - If warn/block: show `<Dialog>` or Sonner + rich toast with expected range + "Submit anyway" (for warn) or hard prevent (block, rare).
  - Pass-through still calls server (server is final arbiter).
  - Add subtle "Hardware validation powered by curated catalog vX" footer note.

- **`app/admin/page.tsx`**:
  - Import catalog + version.
  - New tab or section "Performance Catalog" (after Hardware Aliases):
    - Show `CATALOG_VERSION`.
    - Read-only table of entries (filterable by vendor/series).
    - "Export JSON" button (for curator handoff).
    - Phase 2+: "Import JSON overrides" (applies to local/demo; real later writes to DB table).
    - Stats tile update: include catalog entry count.
  - Keep existing alias CRUD unchanged.

- **`supabase/schema.sql`**:
  - Add `hardware_performance` table + RLS + indexes (as specified in §6).
  - Optional: comment block "Added for hardware validation catalog (Planner 1)".

- **`components/profile-rig-editor.tsx`** & **`components/compatibility-checker.tsx`** (light):
  - Optional future: on rig save, run a "rig health" check against catalog and show "Your saved rig (RTX 4070 + 7800X3D) is high-mid range — great for 1440p."
  - No blocking changes required for MVP.

- **Other minor**:
  - `app/games/[slug]/page.tsx`: Ensure submit dialog receives any needed props (no change likely).
  - Root docs/README or PHASE files: mention new catalog in "Phase 6" notes (non-blocking).
  - `lib/utils.ts` or sanitize: no changes needed.

**No new deps**. Pure TS + existing UI components.

---

## 9. Phased Rollout (Actionable Timeline)

**MVP / Week 1 (Immediate value, minimal risk)**:
- New catalog + normalize + validate pure functions + seeded data.
- Client warning in submit dialog.
- Server enforcement (block + flag) in `submitReportAction`.
- Basic admin catalog viewer + version display (read-only).
- Update prediction similarity with small hardware perf bonus.
- Full anon + auth parity (static = works everywhere).
- Test matrix: known good (4090 + high FPS), borderline (mid GPU + high claim), absurd.
- Deploy behind existing flag; document in admin.

**Phase 2 (2-3 weeks later)**:
- DB table + seed script + real-mode admin editor (full CRUD on catalog, with audit).
- Wider admin tooling: bulk import from JSON (curator output).
- Enhanced stats in admin (mismatch rate over time).
- Per-report "hardware score" badge in moderation queue.
- Tune constants from real flagged data.

**Phase 3 (later, optional)**:
- Optional external refresh pipeline (local curator scripts using approved GH scrapers → versioned patch).
- Per-game baseline table (`game_hardware_perf_baselines`) populated from approved reports + catalog.
- ML-lite or regression fallback for un-catalogued hardware.
- Public API exposure of catalog (read-only) for community tools.
- Advanced outlier detection (compare submitted vs historical same-hardware reports for same game).

**Rollback**: Remove catalog calls; validation becomes no-op. Safe (additive).

---

## 10. Risks, Mitigations & Edge Cases

**Major Risks**:
1. **Data Staleness / New Hardware (RTX 50xx, RDNA4, etc.)**: Unknown canonical → wide band + "unknown" reason. Mitigation: curator process documented; admin sees "catalog coverage: 87% of recent GPUs".
2. **Over-flagging Legitimate Users** (OC, undervolt, frame-gen/DLSS tricks, RAM speed/timings, specific patches, laptop vs desktop power limits, 1% low measurement variance, driver magic):
   - **Mitigation (critical)**: Extremely wide initial bands (48%-210%+). Hard `block` only for absurd outliers (e.g. 3.5×+ or sub-10 fps on flagship). Always soft client warning first. Human moderator review for all `flagged` (existing flow). Add user notes field influence in future ("I used lossless scaling").
3. **Model Inaccuracy (CPU bottlenecks at low res/high refresh, game-specific engines, RT on/off)**: Game difficulty factors + wide bands absorb. Validation is "plausibility gate", not precision oracle.
4. **AMD vs NVIDIA vs Intel Bias**: PassMark/TPU are cross-vendor; ratios calibrated from public gaming reviews. Monitor flagged distribution in Phase 2 admin.
5. **Anonymous / localStorage Parity & Aliases**: Catalog is fully static/pure → identical. Aliases (currently local-only) enhance both paths equally.
6. **Anti-abuse Integration Complexity**: Added as defense-in-depth inside existing rate/dup block. Never bypasses RLS or mod review.
7. **Performance**: Static map lookup = O(1), negligible on submit.
8. **Legal/Attribution**: All sources cited in code. No runtime scraping.

**Other**:
- RAM speed / storage / driver not modeled in MVP (future notes field can capture).
- Multiple GPUs (SLI/CrossFire rare now) → ignore.
- Custom settings "Custom" preset → use 'High' baseline + wider band.

---

## 11. Integration with Current Anti-Abuse & Full User Flows

- **submitReportAction** (and future RPC): Primary enforcement point. Extends existing rate-limit + exact-dup checks.
- **Client dialog + rig editors**: Best UX (early feedback).
- **Compatibility checker & predictions**: Secondary consumers (improved similarity; optional rig validation display).
- **Admin / moderation**: Flagged reports surface with rich `moderatorNotes` containing validation details. Mods can override status as today.
- **My Rig (profiles + user_rigs + localStorage)**: Same raw strings → same normalization → future "rig score" display.
- **Anonymous fully supported**: No auth required anywhere in validation path.

---

## 12. Suggested Schema Additions (Full)

(See §6 for exact `CREATE TABLE hardware_performance ...` + RLS.)

Future extensions (Phase 2/3 comments in schema):
- `game_hardware_perf_baselines` (game_id + canonical_gpu + resolution + preset → measured avg fps from approved reports).
- `report_validation_logs` (audit table for every submit validation).

---

## 13. Testing & Verification Recommendations

- Unit tests for `validateHardwarePerformance` (good / warn / block cases) — add to existing test patterns or new `lib/__tests__`.
- E2E: Submit via dialog (real + mock flag modes) with known hardware/FPS combos; verify toasts + flagged status + mod notes.
- Admin: Verify catalog tab renders version + entries.
- Real-data mode: Submit with `NEXT_PUBLIC_USE_REAL_DATA=true` (anon + logged-in); confirm server validation runs.
- Regression: Existing prediction / stats / submit flows unchanged when catalog returns "ok".

---

## 14. Maintenance & Update Process (Post-Launch)

1. Curator updates `hardware-performance-catalog.ts` (add new cards, bump version, improve notes).
2. PR with diff + "Catalog vYYYY.MM.DD: Added RTX 5090 (perfIndex 105.2 from fresh PassMark/TPU)".
3. Deploy.
4. (Phase 2+) Admin UI "Propose catalog update" flow that generates JSON for curator or direct DB write (role-gated).
5. Monitor `/admin` for mismatch rate trends.

---

This plan is complete, self-contained, and directly actionable. Implementation can begin immediately with the catalog file + types, then wire the two hot paths (dialog + action). It respects all existing architecture (data adapter, real/mock split, RLS, moderation, anon support, Phase 4 alias foundation) while delivering the missing hardware plausibility layer.

**Next step for implementers**: Read this plan + `lib/hardware-performance-catalog.ts` skeleton (to be created), then seed the first 20 entries and wire the validation call in `submitReportAction`.

— Hardware Validation Planner Agent #1 (Data & Catalog Focus)