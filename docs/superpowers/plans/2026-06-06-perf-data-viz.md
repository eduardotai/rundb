# Performance Data Viz (Game Detail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-only Community Stats on the game detail page with a ProtonDB-style segmented tier-distribution bar, scaled average-FPS-by-resolution bars, and an optional "your rig" marker — using existing tier color variables and zero new dependencies.

**Architecture:** One pure, unit-tested helper module (`lib/chart-helpers.ts`) holds all math/ordering. Two thin presentational client components (`components/charts/`) render bars from existing `GameStats` data using the `--tier-*` CSS variables already defined in `globals.css`. The game detail page swaps two sub-blocks inside its existing Community Stats card and adds one React Query for the rig prediction. No data-layer, schema, or theme changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, TanStack React Query, Node test runner (`tsx --test`).

**Working directory:** All commands run from the worktree root `C:\Users\taken\grokbuild\.claude\worktrees\feature+perf-data-viz` (branch `worktree-feature+perf-data-viz`).

**Spec:** `docs/superpowers/specs/2026-06-06-perf-data-viz-design.md`

---

## File Structure

**Create:**
- `lib/chart-helpers.ts` — pure logic: tier segment math, resolution ordering, FPS bar scaling + color bucket.
- `tests/chart-helpers.test.ts` — focused unit tests for the helper.
- `components/charts/tier-distribution-bar.tsx` — segmented tier bar + legend + rig marker.
- `components/charts/fps-resolution-bars.tsx` — horizontal FPS-by-resolution bars.

**Modify:**
- `app/games/[slug]/page.tsx` — swap the tier grid + FPS list inside the Community Stats card, add the prediction query, reshape the stats loading skeleton, drop the now-unused `PerformanceBadge` import.

---

## Task 1: Pure helper module (`lib/chart-helpers.ts`)

**Files:**
- Create: `lib/chart-helpers.ts`
- Test: `tests/chart-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/chart-helpers.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TIER_ORDER,
  tierSegments,
  sortResolutions,
  fpsBarPct,
  fpsBucket,
} from '../lib/chart-helpers'

test('tierSegments returns all five tiers in order with pct + rawPct', () => {
  const dist = { Excellent: 2, Good: 1, Playable: 1, Struggling: 0, Unplayable: 0 }
  const segs = tierSegments(dist, 4)
  assert.deepEqual(segs.map((s) => s.tier), TIER_ORDER)
  assert.equal(segs[0].count, 2)
  assert.equal(segs[0].pct, 50)
  assert.equal(segs[0].rawPct, 50)
  assert.equal(segs[3].count, 0)
  assert.equal(segs[3].pct, 0)
})

test('tierSegments with zero total yields all-zero, no divide-by-zero', () => {
  const dist = { Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0 }
  const segs = tierSegments(dist, 0)
  assert.equal(segs.length, 5)
  for (const s of segs) {
    assert.equal(s.pct, 0)
    assert.equal(s.rawPct, 0)
  }
})

test('sortResolutions orders by pixel area, most demanding first', () => {
  const out = sortResolutions(['1920x1080', '3840x2160', '2560x1440'])
  assert.deepEqual(out, ['3840x2160', '2560x1440', '1920x1080'])
})

test('sortResolutions understands shorthand and unicode multiplier', () => {
  const out = sortResolutions(['1080p', '4K', '1440p', '2560×1440'])
  // 4K (3840x2160) > 1440p == 2560×1440 (stable by input order) > 1080p
  assert.deepEqual(out, ['4K', '1440p', '2560×1440', '1080p'])
})

test('sortResolutions puts unparseable keys last, stably', () => {
  const out = sortResolutions(['ultrawide', '1920x1080', 'potato'])
  assert.deepEqual(out, ['1920x1080', 'ultrawide', 'potato'])
})

test('fpsBarPct is proportional and clamped', () => {
  assert.equal(fpsBarPct(60, 120), 50)
  assert.equal(fpsBarPct(0, 120), 0)
  assert.equal(fpsBarPct(200, 120), 100)
  assert.equal(fpsBarPct(60, 0), 0)
})

test('fpsBucket boundaries', () => {
  assert.equal(fpsBucket(29), 'low')
  assert.equal(fpsBucket(30), 'ok')
  assert.equal(fpsBucket(59), 'ok')
  assert.equal(fpsBucket(60), 'good')
  assert.equal(fpsBucket(119), 'good')
  assert.equal(fpsBucket(120), 'high')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/chart-helpers.test.ts`
Expected: FAIL — cannot find module `../lib/chart-helpers` (or undefined exports).

- [ ] **Step 3: Write the implementation**

Create `lib/chart-helpers.ts`:

```ts
import type { PerformanceTier } from '@/lib/types';

export interface TierSegment {
  tier: PerformanceTier;
  count: number;
  pct: number;    // rounded, for display
  rawPct: number; // unrounded, for bar width
}

// Fixed display order, best -> worst.
export const TIER_ORDER: PerformanceTier[] = [
  'Excellent',
  'Good',
  'Playable',
  'Struggling',
  'Unplayable',
];

export function tierSegments(
  distribution: Record<PerformanceTier, number>,
  total: number,
): TierSegment[] {
  return TIER_ORDER.map((tier) => {
    const count = distribution[tier] ?? 0;
    const rawPct = total > 0 ? (count / total) * 100 : 0;
    return { tier, count, rawPct, pct: Math.round(rawPct) };
  });
}

// Parse a resolution key to its pixel area, or null if unrecognized.
// Handles "1920x1080", "2560×1440", "1080p"/"1440p"/"2160p", and "2K"/"4K"/"8K".
export function resolutionArea(key: string): number | null {
  const s = key.trim().toLowerCase();

  const wh = s.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
  if (wh) return parseInt(wh[1], 10) * parseInt(wh[2], 10);

  const p = s.match(/^(\d{3,4})p$/);
  if (p) {
    const h = parseInt(p[1], 10);
    const w = Math.round((h * 16) / 9);
    return w * h;
  }

  if (s === '2k') return 2560 * 1440;
  if (s === '4k') return 3840 * 2160;
  if (s === '8k') return 7680 * 4320;

  return null;
}

// Order resolution keys by pixel area, most demanding first.
// Known resolutions come before unknown ones; ties and unknowns keep input order (stable).
export function sortResolutions(keys: string[]): string[] {
  return keys
    .map((key, i) => ({ key, i, area: resolutionArea(key) }))
    .sort((a, b) => {
      const aKnown = a.area !== null;
      const bKnown = b.area !== null;
      if (aKnown && bKnown) {
        if (b.area! !== a.area!) return b.area! - a.area!;
        return a.i - b.i;
      }
      if (aKnown) return -1;
      if (bKnown) return 1;
      return a.i - b.i;
    })
    .map((o) => o.key);
}

// Bar fill percentage (0-100) for an FPS value relative to the max across rows.
export function fpsBarPct(fps: number, maxFps: number): number {
  if (maxFps <= 0) return 0;
  const pct = (fps / maxFps) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

export type FpsBucket = 'low' | 'ok' | 'good' | 'high';

// Semantic FPS bucket used to pick a bar color. No Tailwind/CSS here on purpose.
export function fpsBucket(fps: number): FpsBucket {
  if (fps < 30) return 'low';
  if (fps < 60) return 'ok';
  if (fps < 120) return 'good';
  return 'high';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test tests/chart-helpers.test.ts`
Expected: PASS — all 8 tests pass (`# pass 8`, `# fail 0`).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/chart-helpers.ts tests/chart-helpers.test.ts
git commit -m "feat(charts): pure helpers for tier segments, resolution order, fps scaling"
```

---

## Task 2: Tier distribution bar component

**Files:**
- Create: `components/charts/tier-distribution-bar.tsx`

This component is presentational; it is verified by typecheck + lint + the Task 4 smoke test (no unit test — it has no logic beyond rendering the Task 1 helpers).

- [ ] **Step 1: Write the component**

Create `components/charts/tier-distribution-bar.tsx`:

```tsx
'use client';

import type { PerformanceTier } from '@/lib/types';
import { TIER_ORDER, tierSegments } from '@/lib/chart-helpers';
import { cn } from '@/lib/utils';

interface TierDistributionBarProps {
  distribution: Record<PerformanceTier, number>;
  total: number;
  predictedTier?: PerformanceTier | null;
  confidence?: number; // 0-1
}

// Reuse the same palette as PerformanceBadge via the CSS variables in globals.css.
const tierVar: Record<PerformanceTier, string> = {
  Excellent: 'var(--tier-excellent)',
  Good: 'var(--tier-good)',
  Playable: 'var(--tier-playable)',
  Struggling: 'var(--tier-struggling)',
  Unplayable: 'var(--tier-unplayable)',
};

export function TierDistributionBar({
  distribution,
  total,
  predictedTier,
  confidence,
}: TierDistributionBarProps) {
  if (total <= 0) {
    return (
      <div className="rounded-full border border-dashed border-border bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
        No reports yet
      </div>
    );
  }

  const segments = tierSegments(distribution, total);
  const summary = segments
    .filter((s) => s.count > 0)
    .map((s) => `${s.pct}% ${s.tier}`)
    .join(', ');

  const lowConfidence = typeof confidence === 'number' && confidence < 0.34;
  const confidenceLabel =
    typeof confidence === 'number' && !lowConfidence
      ? `~${Math.round(confidence * 100)}% confidence`
      : 'estimate';

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`Tier distribution: ${summary}`}
        className="flex h-4 w-full overflow-hidden rounded-full border border-border bg-muted"
      >
        {segments
          .filter((s) => s.rawPct > 0)
          .map((s) => (
            <div
              key={s.tier}
              className="h-full"
              style={{ width: `${s.rawPct}%`, backgroundColor: tierVar[s.tier] }}
              title={`${s.tier}: ${s.pct}%`}
            />
          ))}
      </div>

      {predictedTier && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-xs',
            lowConfidence ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span
            className="inline-block h-2 w-2 rotate-45 rounded-[1px]"
            style={{ backgroundColor: tierVar[predictedTier] }}
            aria-hidden
          />
          <span>
            Your rig: <span className="font-medium">{predictedTier}</span>{' '}
            <span className="text-muted-foreground">({confidenceLabel})</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {TIER_ORDER.map((tier) => {
          const seg = segments.find((s) => s.tier === tier)!;
          return (
            <div
              key={tier}
              className={cn(
                'flex items-center justify-between gap-2 text-xs',
                seg.count === 0 && 'opacity-40',
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: tierVar[tier] }}
                  aria-hidden
                />
                <span className="text-muted-foreground">{tier}</span>
              </span>
              <span className="font-mono tabular-nums text-foreground">{seg.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

> **Marker note:** the spec's "pin over the segment" is realized as a labeled marker line beneath the bar (color swatch + tier + confidence/estimate). This is robust when the predicted tier has a zero-width segment, which an absolutely-positioned pin is not.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint components/charts/tier-distribution-bar.tsx`
Expected: no errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add components/charts/tier-distribution-bar.tsx
git commit -m "feat(charts): segmented tier-distribution bar with legend + rig marker"
```

---

## Task 3: FPS-by-resolution bars component

**Files:**
- Create: `components/charts/fps-resolution-bars.tsx`

- [ ] **Step 1: Write the component**

Create `components/charts/fps-resolution-bars.tsx`:

```tsx
'use client';

import {
  fpsBarPct,
  fpsBucket,
  sortResolutions,
  type FpsBucket,
} from '@/lib/chart-helpers';

interface FpsResolutionBarsProps {
  avgFpsByResolution: Record<string, number>;
}

// Bucket -> tier CSS variable (reuses globals.css palette; no new CSS).
const bucketVar: Record<FpsBucket, string> = {
  low: 'var(--tier-struggling)',
  ok: 'var(--tier-playable)',
  good: 'var(--tier-excellent)',
  high: 'var(--tier-good)',
};

export function FpsResolutionBars({ avgFpsByResolution }: FpsResolutionBarsProps) {
  const keys = sortResolutions(Object.keys(avgFpsByResolution));

  if (keys.length === 0) {
    return <div className="text-muted-foreground">Not enough data yet.</div>;
  }

  const max = Math.max(...keys.map((k) => avgFpsByResolution[k]));
  const showRef = max >= 60;

  return (
    <div className="space-y-2">
      {keys.map((res) => {
        const fps = avgFpsByResolution[res];
        return (
          <div key={res} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0 font-mono tabular-nums text-muted-foreground">
              {res}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${fpsBarPct(fps, max)}%`,
                  backgroundColor: bucketVar[fpsBucket(fps)],
                }}
              />
              {showRef && (
                <div
                  className="absolute inset-y-0 w-px bg-foreground/30"
                  style={{ left: `${fpsBarPct(60, max)}%` }}
                  aria-hidden
                  title="60 FPS"
                />
              )}
            </div>
            <span className="w-16 shrink-0 text-right font-medium tabular-nums text-foreground">
              {fps} FPS
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint components/charts/fps-resolution-bars.tsx`
Expected: no errors/warnings.

- [ ] **Step 4: Commit**

```bash
git add components/charts/fps-resolution-bars.tsx
git commit -m "feat(charts): scaled avg-FPS-by-resolution bars with 60fps reference"
```

---

## Task 4: Integrate into the game detail page

**Files:**
- Modify: `app/games/[slug]/page.tsx`

- [ ] **Step 1: Add the component + prediction imports**

In `app/games/[slug]/page.tsx`, find the data import block:

```tsx
import {
  loadMyRigAsync,
  voteReport,
  getReportsForGameAsync,
  computeGameStatsAsync,
  useGame,
} from '@/lib/data';
```

Replace it with (adds `predictForUserRigAsync`):

```tsx
import {
  loadMyRigAsync,
  voteReport,
  getReportsForGameAsync,
  computeGameStatsAsync,
  predictForUserRigAsync,
  useGame,
} from '@/lib/data';
```

Then find this import line:

```tsx
import { PerformanceBadge } from '@/components/performance-badge';
```

Replace it with the two chart component imports (the page no longer uses `PerformanceBadge` after Step 3):

```tsx
import { TierDistributionBar } from '@/components/charts/tier-distribution-bar';
import { FpsResolutionBars } from '@/components/charts/fps-resolution-bars';
```

- [ ] **Step 2: Add the prediction query**

Find the `statsQuery` declaration:

```tsx
  const statsQuery = useQuery({
    queryKey: ['game-stats', game.id],
    queryFn: () => computeGameStatsAsync(game.id),
  });
```

Immediately after it, add:

```tsx
  // Rig prediction for the "your rig lands here" marker on the tier bar.
  // Keyed by a hardware signature so switching rigs (or sign-in/out) refetches.
  const rigSignature = myRig ? `${myRig.cpu}|${myRig.gpu}|${myRig.ram}` : 'none';
  const predictionQuery = useQuery({
    queryKey: ['game-prediction', game.id, rigSignature],
    enabled: !!myRig,
    queryFn: () => predictForUserRigAsync(myRig!, game.id),
  });
```

- [ ] **Step 3: Replace the tier-distribution grid**

Find this block (the rendered, non-skeleton tier grid):

```tsx
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {Object.entries(stats.tierDistribution).map(([tier, count]) => {
                    const pct = stats.totalReports ? Math.round((count / stats.totalReports) * 100) : 0;
                    return (
                      <div key={tier} className="flex items-center justify-between text-sm">
                        <PerformanceBadge tier={tier as PerformanceTier} size="sm" />
                        <span className="tabular-nums font-mono text-muted-foreground">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
```

Replace it with:

```tsx
                <TierDistributionBar
                  distribution={stats.tierDistribution}
                  total={stats.totalReports}
                  predictedTier={predictionQuery.data?.predictedTier ?? null}
                  confidence={predictionQuery.data?.confidence}
                />
```

- [ ] **Step 4: Replace the avg-FPS-by-resolution list**

Find this block:

```tsx
                <div className="mt-5 border-t border-border pt-4 text-sm">
                  <div className="font-medium mb-1">Average FPS by Resolution</div>
                  {Object.keys(stats.avgFpsByResolution).length > 0 ? (
                    <div className="space-y-1 text-muted-foreground">
                      {Object.entries(stats.avgFpsByResolution).map(([res, fps]) => (
                        <div key={res} className="flex justify-between tabular-nums">
                          <span>{res}</span>
                          <span className="font-medium text-foreground">{fps} FPS</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Not enough data yet.</div>
                  )}
                </div>
```

Replace it with:

```tsx
                <div className="mt-5 border-t border-border pt-4 text-sm">
                  <div className="font-medium mb-2">Average FPS by Resolution</div>
                  <FpsResolutionBars avgFpsByResolution={stats.avgFpsByResolution} />
                </div>
```

- [ ] **Step 5: Reshape the stats loading skeleton**

Find the skeleton block inside the stats card (the `statsQuery.isLoading ?` branch):

```tsx
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-4 w-8" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-border pt-4 text-sm">
                  <div className="font-medium mb-1">Average FPS by Resolution</div>
                  <div className="space-y-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex justify-between tabular-nums">
                        <Skeleton className="h-3.5 w-16" />
                        <Skeleton className="h-3.5 w-12" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
```

Replace it with (one wide bar + legend rows + FPS row skeletons, matching the new shapes):

```tsx
              <div className="space-y-4">
                <Skeleton className="h-4 w-full rounded-full" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-3.5 w-full" />
                  ))}
                </div>
                <div className="mt-3 border-t border-border pt-4 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-3 w-full" />
                  ))}
                </div>
              </div>
```

- [ ] **Step 6: Remove the now-unused `PerformanceTier` import if it is unused**

`PerformanceTier` was used only by the deleted `PerformanceBadge` grid. Check the current import line:

```tsx
import { Report, ReportFilters, PerformanceTier, Game, UserPC } from '@/lib/types';
```

If `PerformanceTier` no longer appears anywhere else in the file (verify with a search), drop it:

```tsx
import { Report, ReportFilters, Game, UserPC } from '@/lib/types';
```

Run to confirm before editing: `npx eslint app/games/[slug]/page.tsx` — if it flags `PerformanceTier` as unused, remove it as shown. (Leave it if some other usage remains.)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors/warnings (in particular, no "unused PerformanceBadge / PerformanceTier" complaints).

- [ ] **Step 9: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including `tests/chart-helpers.test.ts`.

- [ ] **Step 10: Manual smoke test**

Run: `npm run dev`, then open a game detail page (`/games/<slug>`). Verify:
1. A game with several reports shows the segmented tier bar + legend, and FPS bars whose values match the previous text figures.
2. Save a rig (via the compatibility checker / profile) → the "Your rig: <tier>" marker appears with a confidence or "estimate" label; it updates on sign-in/out.
3. A game with zero reports shows the dashed "No reports yet" track and "Not enough data yet."; no console errors; no marker.
4. A single-resolution game: that FPS bar fills to 100%; layout intact.

(Per project note: do NOT run `next build` against the live dev server — tsc + eslint + tests above are the static gate.)

- [ ] **Step 11: Commit**

```bash
git add app/games/[slug]/page.tsx
git commit -m "feat(game-detail): visualize community stats with tier + fps bars and rig marker"
```

---

## Self-Review

**Spec coverage:**
- Segmented tier-distribution bar → Task 2 + Task 4 Step 3. ✓
- Avg-FPS-by-resolution bars (scaled, color-coded, 60fps tick) → Task 3 + Task 4 Step 4. ✓
- "Your rig lands here" marker via `predictForUserRigAsync` → Task 4 Steps 1–3. ✓
- Pure helper module + focused tests → Task 1. ✓
- Skeleton reshaped to match new layouts → Task 4 Step 5. ✓
- Reuse existing tier palette, no new deps, no theme/CSS changes → tier `--tier-*` vars used inline in Tasks 2–3. ✓
- Scope limited to the Community Stats card → only `app/games/[slug]/page.tsx` modified. ✓
- "Most common preset" line preserved → not touched by any edit. ✓
- Empty/zero-report + single-resolution + low-confidence edge cases → handled in Tasks 2–3, smoke-checked in Task 4 Step 10. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every code step contains complete code. ✓

**Type consistency:** `TierSegment`, `TIER_ORDER`, `tierSegments`, `sortResolutions`, `fpsBarPct`, `fpsBucket`, `FpsBucket` defined in Task 1 are used with matching names/signatures in Tasks 2–4. Component prop names (`distribution`, `total`, `predictedTier`, `confidence`, `avgFpsByResolution`) match their call sites in Task 4. `predictForUserRigAsync(userPC, gameId)` and `PredictionResult.predictedTier`/`.confidence` match `lib/data.ts` and `lib/types.ts`. ✓
