# Hardware Validation Planner Agent #2: Validation Logic & Submit Flow Implementation Plan

**Focus:** Pure Validation Engine + Tight Integration into Report Submission Hot Path (Client Dialog + Authoritative Server Action)  
**Date:** 2026-05-26  
**Context:** Complements Planner Agent #1 (`plans/planner-1-hardware-catalog-plan.md`). Planner 1 delivers the static `lib/hardware-performance-catalog.ts` (with `HardwarePerfEntry`, seeded GPU/CPU catalogs, `perfIndex`, factors, normalization, and `estimateExpectedFps` / `validateHardwarePerformance` pure functions) + types in `lib/types.ts` + DB migration path. This plan focuses exclusively on **consuming that catalog for validation**, computing `HardwareValidationResult`, and wiring it into the two critical submit paths without ambiguity.  
**Goal:** Every report submission (anonymous/auth, mock/real via `NEXT_PUBLIC_USE_REAL_DATA`) runs hardware plausibility checks. Legitimate variance (OC, DLSS + Frame Gen, capture error, 1% low measurement noise) tolerated with very wide bands. Egregious claims → client hard block or soft warn + server `status='flagged'` + rich structured `moderatorNotes`. Existing anti-abuse, FPS-only tier calc, RLS, moderation flow, and anon parity are preserved and composed cleanly.

All terminology, shapes, and phased approach are **coordinated 1:1 with Planner 1**. Read Planner 1 first.

---

## 1. Summary of Relevant Existing Submit Hot Path (Post-Inspection)

### `app/actions/reports.ts` (authoritative server path — the critical enforcement point)
- `submitReportAction(input: SubmitReportInput): Promise<Report>`
- **Order today (lines 66-151):**
  1. Auth + game existence lookup (lines 68-80)
  2. `const avgFps = ...; const tier = calculatePerformanceTier(avgFps)` (pure FPS-only, lines 82-83)
  3. **Anti-abuse (auth users only, lines 86-113):** rate limit (5/hr), exact duplicate (game+cpu+gpu+ram+res, 24h). Throws friendly `Error`.
  4. Build `insertPayload` (no `status`, no `moderator_notes` — relies on schema defaults `status='pending'`)
  5. Insert → `mapDbReportToReport`
- `ReportStatus` includes `'flagged'`. `moderatorNotes` field exists on `Report` and is visible in `/admin` table (small text under status badge).
- No hardware plausibility logic today.

### `components/submit-report-dialog.tsx` (primary client entry point)
- Zod schema + RHF (sanitizes cpu/gpu/notes via `sanitizeFullName` transforms).
- `onSubmit` (lines 76-113): `await addUserReport({...})` then success toast + reset/close. Catch shows `showUserError` (friendly, from server throws or generic).
- Uses Sonner via `lib/toast.ts` (`showUserError`, `showUserSuccess`).
- No pre-submit validation beyond Zod numbers (avgFps 1-600).
- Rendered from `app/games/[slug]/page.tsx` (with RQ invalidation on success) and `app/submit/page.tsx`.

### `lib/data.ts` adapter
- `addUserReport` (lines 627-656): if `USE_REAL` → dynamic import + call `submitReportAction`; else `mock.addUserReport`.
- Re-exports pure helpers (`calculateSimilarity`, `extractGpuSeries`, etc.) from mock.
- Real path never runs client validation today.

### `lib/mock-data.ts`
- `addUserReport` (line 366): purely localStorage, no status, no moderatorNotes, no validation. Demo-only.
- Existing hardware helpers (`extractGpuSeries`, `getCpuTier`, `calculateSimilarity`) are series/keyword based — **orthogonal** to new perf-catalog (future synergy noted in Planner 1 §7).

### `lib/types.ts`
- `SubmitReportInput` (lines 108-124) — exact shape passed to action/dialog.
- `Report` has optional `status`, `moderatorNotes`.
- `ReportStatus = 'pending' | 'approved' | 'rejected' | 'flagged'`.
- `HardwareAlias` exists (Phase 4) — catalog uses separate `HardwarePerfEntry` (canonical-keyed).

### Schema (`supabase/schema.sql`)
- `reports.status` defaults `'pending'`, `moderator_notes text`.
- `fps_1_percent_low` supported.
- No hardware_performance table yet (Planner 1 §6 provides exact `CREATE TABLE` for Phase 2).

**Key invariants to preserve:**
- Validation is **additive defense-in-depth** (never replaces rate/dup).
- Tier calc remains FPS-only.
- Server (action) is final arbiter.
- Client validation = UX only (warnings + hard prevent for blocks).
- Works identically for anon + auth + mock + real.
- Non-accusatory language everywhere.

---

## 2. Exact Pure Function(s) to Implement (Signatures + Contract)

All validation logic lives in the catalog module created per Planner 1 (`lib/hardware-performance-catalog.ts`). The functions are **pure, deterministic, zero side-effects, importable on client and server**.

### Primary Entry Point (MVP)
```ts
// In lib/hardware-performance-catalog.ts (exported + re-exported via lib/data.ts for convenience)
export function validateHardwarePerformance(input: {
  gameId: string;
  cpu: string;
  gpu: string;
  ram: number;
  resolution: string;           // e.g. "2560x1440"
  settingsPreset: GraphicsPreset;
  avgFps: number;
  fps1PercentLow?: number;
}): HardwareValidationResult;
```

- **Input source:** Can be constructed from `SubmitReportInput` (preferred for submit hot path) or a full `Report`.
- **Output:** Exactly the `HardwareValidationResult` shape defined in Planner 1 §2:
  ```ts
  export interface HardwareValidationResult {
    isPlausible: boolean;                    // true unless severity === 'block'
    severity: 'ok' | 'warn' | 'block';
    confidence: number;                      // 0-1 (catalog coverage + data quality)
    expectedRange: { min: number; max: number; expected: number };
    submittedFps: number;
    deviationRatio: number;                  // submitted / expected (0 if expected==0)
    canonicalGpu?: string;
    canonicalCpu?: string;
    reason?: string;                         // Human + machine readable (for moderatorNotes + toasts)
    catalogVersion: string;                  // e.g. '2026.05.26-v1'
  }
  ```
- **Side effects:** None. Safe for hot path (O(1) map lookups).
- **Graceful degradation:** Unknown hardware → wide bands + explicit "catalog miss" in reason + reduced confidence.

### Supporting Pure Helpers (also in catalog module, per Planner 1)
- `getCanonicalHardware(raw: string, aliases?: HardwareAlias[]): string | null`
- `getHardwarePerf(canonicalOrRaw: string, aliases?: HardwareAlias[]): HardwarePerfEntry | null`
- `estimateExpectedFps(...)` (internal or exported for admin/debug)
- Internal: `buildValidationReason(...)`, `apply1PercentLowRules(...)`

Re-export convenience wrappers from `lib/data.ts` (static-first, like existing pure helpers):
```ts
export { validateHardwarePerformance } from './hardware-performance-catalog';
// Future: async variants only for admin catalog CRUD
```

**Normalization synergy (Planner 1 §5):** `getCanonicalHardware` reuses/enhances `extractGpuSeries` + `sanitizeFullName` + static seed of common aliases (the 6 defaults from `mock-data.ts:getDefaultHardwareAliases` + the 50-80 seeded canonicals). For server action safety (no localStorage), the catalog file contains a **self-contained authoritative raw→canonical map** (small, ~30-50 common variants). Future DB aliases (Phase 2) are optional overrides only.

---

## 3. Step-by-Step Algorithm for Deviation, Severity, Expected Range, and Reason

(Concrete, calibrated constants for implementer; tune only after real flagged data in Phase 2. Matches Planner 1 §7 sketch + risk mitigations §10.)

1. **Canonicalization (reuse pipeline)**
   - `canonicalGpu = getCanonicalHardware(input.gpu)` (exact CI match on aliases → canonical, then heuristics: "4090", "rtx4090", series extraction, vendor stripping).
   - `canonicalCpu = getCanonicalHardware(input.cpu)` (similar for Intel/AMD naming).
   - `g = GPU_CATALOG[canonicalGpu]?.perfIndex ?? FALLBACK_UNKNOWN_GPU` (45.0)
   - `c = CPU_CATALOG[canonicalCpu]?.perfIndex ?? FALLBACK_UNKNOWN_CPU` (52.0)

2. **Rig + Context Factors (exact formula from Planner 1, with tuned constants)**
   ```ts
   const BASE_EXPECTED = 92;           // High-end rig @ 1440p High in "average modern" title
   const GPU_WEIGHT = 0.78;
   const rigFactor = GPU_WEIGHT * (g / 100) + (1 - GPU_WEIGHT) * (c / 100);
   const resF = RESOLUTION_FACTORS[input.resolution] ?? 0.67;  // 1080p=1.0, 1440p≈0.72, 4K≈0.42
   const presetF = PRESET_FACTORS[input.settingsPreset] ?? (input.settingsPreset === 'Custom' ? 1.04 : 1.0);
   const gameF = GAME_DIFFICULTY_FACTORS[input.gameId] ?? 0.91; // Per-slug map (Cyberpunk low, CS2/Valorant high)
   const ramF = input.ram >= 32 ? 1.06 : input.ram >= 16 ? 1.0 : 0.84;
   const expected = Math.max(8, Math.round(BASE_EXPECTED * rigFactor * resF * presetF * gameF * ramF));
   ```

3. **Tolerance Bands (extremely wide per risk §10 — OC / FG / DLSS / error / patches)**
   - `baseMinTol = 0.43`, `baseMaxTol = 2.28`
   - If `!canonicalGpu && !canonicalCpu`: `baseMinTol = 0.28`, `baseMaxTol = 3.6`, confidence low.
   - `min = Math.max(4, Math.round(expected * baseMinTol))`
   - `max = Math.round(expected * baseMaxTol)`
   - `submittedFps = input.avgFps`
   - `deviationRatio = expected > 0 ? submittedFps / expected : 0`

4. **1% Low Specific Rules (Planner 1 §7 + this plan §5)**
   - If `fps1PercentLow != null`:
     - If `fps1PercentLow > input.avgFps + 0.5` → immediate `severity='warn'` (or 'block' if > avg*1.1), reason includes "1% low cannot exceed average FPS".
     - `ratio1p = fps1PercentLow / input.avgFps`
     - If `ratio1p > 0.955` → "suspiciously high 1% low (possible capture smoothing / perfect conditions claim)"
     - If `ratio1p < 0.36` → "unusually poor 1% low relative to average (may indicate stutter or measurement setup)"
   - These contribute to reason but do **not** auto-block unless extreme.

5. **Severity Decision (defense-in-depth, never over-flags good data)**
   ```ts
   let severity: 'ok' | 'warn' | 'block' = 'ok';
   const over = deviationRatio;

   if (submittedFps < min || submittedFps > max) {
     if (over > 3.15 || submittedFps > 520 || (over > 2.6 && expected < 55)) {
       severity = 'block';
     } else if (over < 0.21) {
       severity = 'block';
     } else {
       severity = 'warn';
     }
   }
   if (onePercentLowExtremeIssue && severity === 'ok') severity = 'warn';
   if (absurdAbsoluteLowOnHighEndRig) severity = 'warn'; // e.g. 4090 + 4K Ultra + 9 fps
   ```

6. **Confidence**
   - 0.92 if both canonicals resolved with perf entries
   - 0.68 if exactly one
   - 0.41 if neither (unknown hardware)

7. **Human-Readable Reason (non-accusatory template library)**
   - Always includes: catalog version, submitted vs expected range, deviation, canonicals (or "raw input").
   - Examples (see §6 library):
     - Warn high: "Reported avg FPS (240) is 3.4× higher than expected (~71, range 31-162) for RTX 3060 Ti + Ryzen 5 5600X at 3840x2160 Ultra in Cyberpunk 2077 (catalog 2026.05.26-v1). This may reflect frame generation, DLSS/Quality upscaling + FG, overclocking, driver-level tools, or capture variance. Wide tolerance applied."
     - Block: "Reported performance (12 fps) is far below the plausible minimum even for a heavily RT-enabled title on this hardware. Please double-check settings, resolution, and measurement methodology."
   - 1% low clauses appended when triggered.
   - Unknown hardware clause: "Hardware not yet in curated catalog — using conservative mid-range baseline + extra-wide tolerance."

8. **isPlausible** = `severity !== 'block'`

All constants + factor maps + templates live in the catalog file (versioned with `CATALOG_VERSION`).

---

## 4. Precise Code Change Locations + Sketched Diffs

### 4.1 Server Action — `app/actions/reports.ts` (authoritative)

**Location:** Inside `submitReportAction`, **immediately after the duplicate check block (after line 113), before tier calc or insert.**

**Why here:** After rate/dup (existing anti-abuse wins for clean UX), before any DB work. Validation result directly mutates status + moderatorNotes payload. Tier calc untouched.

**Sketched diff (add imports + logic):**

```ts
// At top (after existing imports)
import type { HardwareValidationResult } from '@/lib/types'; // or direct from catalog
import { validateHardwarePerformance } from '@/lib/hardware-performance-catalog'; // pure

// Inside submitReportAction, after line 113 (end of dup check):
  // 3. Hardware performance validation (catalog-driven, after anti-abuse, before insert)
  // Pure function — identical behavior in mock client pre-checks.
  const validation: HardwareValidationResult = validateHardwarePerformance({
    gameId: input.gameId,
    cpu: input.cpu,
    gpu: input.gpu,
    ram: input.ram,
    resolution: input.resolution,
    settingsPreset: input.settingsPreset,
    avgFps,
    fps1PercentLow: input.fps1PercentLow,
  });

  let finalStatus: ReportStatus = 'pending';
  let moderatorNotes: string | null = null;

  if (validation.severity === 'block') {
    // Authoritative hard reject. Message is shown via existing catch in dialog.
    const msg = buildBlockErrorMessage(validation); // helper in same file or imported
    throw new Error(msg);
  }

  if (validation.severity === 'warn') {
    finalStatus = 'flagged';
    moderatorNotes = `AUTO: Hardware perf validation warn (catalog ${validation.catalogVersion}): ${validation.reason}`;
    // Future: could also store structured JSON in a new column, but moderator_notes suffices for MVP.
  }

  // 4. (renumbered) Tier calc stays exactly as-is (FPS-only)
  const tier = calculatePerformanceTier(avgFps);

  // 5. Insert payload — now includes status + moderator_notes when flagged
  const insertPayload = {
    // ... existing fields ...
    avg_fps: avgFps,
    fps_1_percent_low: input.fps1PercentLow ?? null,
    performance_tier: tier,
    // NEW:
    status: finalStatus,                    // 'flagged' overrides default 'pending' when warn
    moderator_notes: moderatorNotes,        // rich structured text for /admin queue
    // ... rest unchanged
  };
```

- Add small private helper `buildBlockErrorMessage(v: HardwareValidationResult): string` using the same reason + "Please verify your measurements or settings and try again." (non-accusatory).
- Update JSDoc at top of file.
- No change to `calculatePerformanceTier` or `mapDbReportToReport`.

**Error propagation:** The thrown Error for 'block' is caught in dialog `onSubmit` catch → `showUserError(friendly)`. Exact server message reaches user.

### 4.2 Client Dialog — `components/submit-report-dialog.tsx`

**Locations:**
- Add imports + state after existing imports/useState (around line 61).
- Inside `onSubmit` (replace/augment the current try block starting line 79).
- Add conditional warning UI in the form JSX (after the driver row, before action buttons, ~line 234).
- Optional: small "Hardware plausibility checked with curated catalog vX" in the existing footer p.

**Sketched state + logic diff:**

```tsx
// New imports
import { validateHardwarePerformance } from '@/lib/hardware-performance-catalog';
import type { HardwareValidationResult } from '@/lib/types';
import { showUserError } from '@/lib/toast'; // already present

// Inside component, after const [isSubmitting...
const [validationResult, setValidationResult] = useState<HardwareValidationResult | null>(null);
const [forceSubmit, setForceSubmit] = useState(false); // for "submit anyway" on warn

// Reset on dialog close / form reset (add in existing reset paths)
const resetValidation = () => { setValidationResult(null); setForceSubmit(false); };

// In onSubmit (augment/replace current try):
const onSubmit = async (values: FormValues) => {
  setIsSubmitting(true);
  resetValidation(); // clear prior

  try {
    // Client pre-validation (pure, fast, same fn as server)
    const v = validateHardwarePerformance({
      gameId: values.gameId,
      cpu: values.cpu,
      gpu: values.gpu,
      ram: values.ram,
      resolution: values.resolution,
      settingsPreset: values.settingsPreset,
      avgFps: values.avgFps,
      fps1PercentLow: values.fps1PercentLow,
    });
    setValidationResult(v);

    if (v.severity === 'block') {
      const msg = v.reason || 'This performance claim is not plausible for the entered hardware.';
      showUserError(msg.length > 140 ? 'Performance claim is outside plausible range for this hardware.' : msg);
      setIsSubmitting(false);
      return;
    }

    if (v.severity === 'warn' && !forceSubmit) {
      // Trigger inline confirmation UI (see JSX below). Do not call addUserReport yet.
      setIsSubmitting(false);
      return;
    }

    // Proceed (warn was confirmed via forceSubmit, or 'ok')
    await addUserReport({ /* existing exact shape */ });

    showUserSuccess('Report submitted — thank you!');
    form.reset();
    resetValidation();
    onOpenChange(false);
    onSuccess?.();
  } catch (e: any) {
    // Existing + server block messages surface here automatically
    const friendly = e?.message || 'Could not submit report. Please try again.';
    showUserError(friendly.length > 110 ? 'Could not submit report. Please try again.' : friendly);
  } finally {
    setIsSubmitting(false);
  }
};

// New handler for "Submit anyway"
const handleSubmitAnyway = () => {
  setForceSubmit(true);
  // Re-trigger submit with current form values (or call a doSubmit internal)
  form.handleSubmit(onSubmit)(); // or extract core submit logic
};
```

**Warning UI JSX (insert before the flex buttons row):**

```tsx
{validationResult && validationResult.severity === 'warn' && !forceSubmit && (
  <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm">
    <div className="font-medium text-amber-400">Hardware plausibility warning</div>
    <p className="mt-1 text-amber-200/90 text-xs leading-snug">
      {validationResult.reason}
    </p>
    <p className="mt-1 text-[10px] text-muted-foreground">
      Expected ~{validationResult.expectedRange.expected} fps (range {validationResult.expectedRange.min}–{validationResult.expectedRange.max}).
      Wide tolerance applied for OC / upscaling / capture differences.
    </p>
    <div className="mt-2 flex gap-2">
      <Button size="sm" variant="ghost" onClick={() => { setValidationResult(null); /* allow edit */ }}>
        Edit values
      </Button>
      <Button size="sm" variant="outline" className="border-amber-500/60" onClick={handleSubmitAnyway}>
        Submit anyway (will be flagged for moderator review)
      </Button>
    </div>
  </div>
)}
```

- On dialog close (`onOpenChange(false)` paths) and form.reset: call `resetValidation()`.
- Footer: append `Hardware plausibility checked via curated catalog.`
- No new UI components required (uses existing Button + div + Tailwind tokens already in file).

**Block never reaches addUserReport on client.** Server block is defense-in-depth (catches direct action calls or future RPCs).

---

## 5. Handling Unknown Hardware, Wide Tolerances, 1% Low, and Edge Cases

- **Unknown canonical:** Fallback perfIndex (mid-range ~45), extra-wide tol (0.28x–3.6x), `confidence ≤ 0.45`, reason explicitly notes "not yet in curated catalog (vX) — using conservative baseline". Still blocks only on truly absurd claims (e.g. 900 fps on unknown low-end).
- **Wide tolerance philosophy (critical per Planner 1 §10):** Initial bands deliberately absorb:
  - Overclocking + undervolting + custom power limits (laptop vs desktop)
  - DLSS/FSR/XeSS Quality + Frame Generation (can 1.8–2.5× effective FPS)
  - Lossless Scaling / driver overlays / RTSS capture variance
  - Game patches, driver magic, RAM timings, storage
  - 1% low measurement differences (in-game vs external)
- **1% Low specific rules (this plan):** See algorithm §4. Implemented inside `validateHardwarePerformance`. Contributes to `reason` and can elevate `ok` → `warn`. Invalid (`> avgFps`) is always at least warn.
- **Other edges:**
  - Custom preset → slightly wider (presetF bump).
  - Very low RAM (<8 GB) → lower expected + note in reason if extreme.
  - High refresh rate + low res → absorbed in factors.
  - Future notes/tweaks field can be used in Phase 2+ to relax specific reports ("frame gen enabled").

---

## 6. Error Message Library (User-Friendly, Non-Accusatory)

Place in catalog module (or small sibling `lib/hardware-validation-messages.ts` re-exported):

```ts
export function buildUserFacingBlockMessage(v: HardwareValidationResult): string {
  return `Reported performance (${v.submittedFps} fps) is not plausible for the hardware described (${v.canonicalGpu || 'your GPU'} + ${v.canonicalCpu || 'your CPU'}) at ${/* res/preset */}. Expected range ~${v.expectedRange.min}–${v.expectedRange.max}. Please double-check your FPS counter, settings, and measurement methodology.`;
}

export function buildValidationReason(...) { /* template engine with variants for high/low/1pLow/unknown */ }
```

**Tone rules (enforced in code):**
- Never: "fake", "cheating", "impossible", "lying".
- Always: "significantly exceeds typical expectations", "far below the plausible minimum even accounting for...", "may reflect...", "wide tolerance applied".
- Include concrete numbers + catalog version for mods.
- Short for toasts (<110 chars when truncated); full rich text for banner + moderatorNotes.

Server block message is the source of truth shown to user on hard failure.

---

## 7. Validation Result Flow Back to Client on Submit Failure (Blocks)

- Block → server throws `Error` with friendly message (constructed from `validation.reason` + guidance).
- Dialog catch (existing, line 106) receives it directly → `showUserError`.
- No special new error channel needed.
- For warn cases that user forces: report is submitted (real → flagged + notes; mock → normal local report). No client error.
- Future: if we add structured validation log table (Planner 1 Phase 3), surface optional "view details" but out of MVP scope.

---

## 8. Composition with Existing Duplicate / Rate Limit Checks

**Strict order in `submitReportAction` (enforced in diff):**
1. Game lookup + basic input sanity
2. **Anti-abuse (rate + dup)** — throws first (clean, specific messages)
3. **Hardware validation** — only reached on clean anti-abuse path
4. Tier calc + insert (with status/notes mutation from validation)

Client pre-check mirrors only for UX (never bypasses server). If client says warn but user forces, server still runs full validation + applies flag.

No interaction with upvoting, moderation actions, or prediction paths (those remain unchanged in MVP).

---

## 9. Real-Data Mode Safety

- `validateHardwarePerformance` is **pure + static data only**. Import in server action (safe) and client dialog (safe — no 'use server' code, no network, no secrets).
- Catalog file must remain dependency-free except for types (`GraphicsPreset` from `@/lib/types`).
- In `lib/data.ts` real path: validation happens inside the imported server action (never client-side for the authoritative result).
- Mock path: client-side validation provides identical UX feedback; submitted localStorage report does not carry `status`/`moderatorNotes` (acceptable demo limitation — admins primarily use real mode for flagged queue).
- No RLS or auth changes. Validation never touches DB in hot path (static source of truth per Planner 1).
- On Supabase error paths: existing fallbacks unchanged (validation still ran).

---

## 10. Unit Test Cases That Must Pass (8–10 Concrete Scenarios)

Add to new `lib/__tests__/hardware-validation.test.ts` (or inline in catalog with `if (process.env.NODE_ENV === 'test')` guards). Use Vitest/Jest. All use the exact seeded catalog + factors from Planner 1 implementation.

1. **Flagship high-FPS OK (Cyberpunk):** RTX 4090 + Ryzen 7 7800X3D, 2560x1440 High, avgFps=102, no 1% low → `severity='ok'`, `deviationRatio ≈ 1.05`, `isPlausible=true`, high confidence.
2. **Mid-GPU insane FPS BLOCK (4K):** RTX 3060 Ti + i5-12400F, 3840x2160 Ultra, avgFps=235 → `severity='block'`, deviation >3.2×, reason mentions 4K + Ultra.
3. **Unknown hardware lenient:** cpu="Custom Threadripper Beast", gpu="RX 9999 XT Mystery", 1080p Medium, avgFps=78 → `severity='ok'` (or soft warn only if extreme), confidence ≤0.45, reason contains "not yet in curated catalog".
4. **Low-end absurd high WARN/BLOCK:** GT 1030 + i3-6100, 1920x1080 Low, avgFps=165 on heavy title → `severity='warn'` (or block if >3.5× fallback).
5. **1% Low invalid (exceeds avg):** avgFps=74, fps1PercentLow=82 → at minimum `severity='warn'`, reason explicitly calls out "1% low cannot exceed average FPS".
6. **Suspiciously perfect 1% Low WARN:** High-end rig, avg=118, fps1PercentLow=116 → `severity='warn'`, reason includes "suspiciously high 1% low".
7. **Legit high with frame-gen tolerance:** 4070 Ti + 5800X3D, 1440p High + "DLSS + FG" in tweaks (validation ignores tweaks for MVP), avgFps=165 (expected ~82) → `severity='warn'` at worst (never block), wide max tol absorbs.
8. **Very low FPS on flagship (plausible heavy RT):** 4090, 4K Ultra RT Overdrive, avgFps=14 → `severity='warn'` (not block), reason notes "below minimum" with tolerance language.
9. **Mid-range excellent match OK:** RX 7800 XT + Ryzen 7 5700X, 2560x1440 High, avgFps=88 in medium-difficulty title → `severity='ok'`, deviation 0.95–1.15.
10. **Absolute sanity block (absurd numbers):** Any hardware, avgFps=580 at 4K Ultra heavy game → `block` regardless of catalog (hard upper guard).

Additional regression: When catalog returns 'ok', **zero** change to downstream (tier, insert payload shape, client success path, admin visibility).

---

## 11. Additional Implementation & Rollout Notes

- **File creation order (with Planner 1):** Create catalog + types + normalize helpers first → wire validation into action + dialog → add admin catalog viewer (Planner 1) → tests → Phase 2 DB table.
- **Admin visibility:** All auto-flagged reports appear in `/admin` moderation queue with rich `moderatorNotes` line (existing rendering at ~line 573 of admin/page.tsx requires zero change). Mods can still approve/reject/append notes.
- **No schema change for MVP:** moderator_notes + status='flagged' sufficient. Future `report_validation_logs` table optional (Planner 1 Phase 3).
- **Performance:** Negligible (static maps). No impact on report list queries.
- **i18n / accessibility:** Reason text is English for MVP (consistent with current toasts/errors). Banner uses existing color tokens.
- **Rollback:** Remove the two call sites + import. Validation becomes no-op. Zero data loss.
- **Monitoring (future):** Track % of submits that hit warn/block in Phase 5 telemetry (mentioned in existing PHASE5 files).

---

## 12. Handoff Checklist for Implementation Agent

- [ ] Read both planner docs fully + inspect the 6 key files listed in this plan.
- [ ] Implement catalog module per Planner 1 (seeded data + pure fns including `validateHardwarePerformance`).
- [ ] Add types to `lib/types.ts` (already sketched in Planner 1).
- [ ] Wire server changes in `app/actions/reports.ts` (exact location + payload mutation).
- [ ] Wire client pre-check + warning banner + "submit anyway" flow in `submit-report-dialog.tsx`.
- [ ] Re-export validate from `lib/data.ts` for future consumers.
- [ ] Write + pass the 10 unit test cases.
- [ ] Verify: real mode (`NEXT_PUBLIC_USE_REAL_DATA=true`) + anon + auth; mock localStorage path; block throws reach user; warn produces flagged + notes.
- [ ] Update any JSDoc / PHASE notes.
- [ ] E2E manual: submit plausible → pending/approved path; submit absurd → block toast; submit borderline → flagged in admin with full reason visible.

This plan + Planner 1 together give a complete, ambiguity-free blueprint. The implementation agent can code the validation engine and submit integration in one focused pass.

**Next step:** Begin with the catalog file (Planner 1) + types, then the action wiring (this plan §4.1), then dialog (§4.2).

— Hardware Validation Planner Agent #2 (Validation Logic & Submit Flow Focus)