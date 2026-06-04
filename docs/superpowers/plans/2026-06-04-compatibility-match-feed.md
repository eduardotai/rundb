# Compatibility Match Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user saves their hardware, automatically show a single ranked feed of the closest-matching game reports across all games, with match %, matching-part labels, and filters.

**Architecture:** Pure ranking/scoring logic lives in `lib/similarity.ts` (unit-tested). A thin async wrapper `getMatchesForRigAsync` in `lib/data.ts` fetches the report pool via the existing `getAllReportsAsync()` and delegates to the pure logic. A new client component `components/match-feed.tsx` renders the feed and owns filter state. `components/compatibility-checker.tsx` drops the manual game-pill selector + per-game prediction blocks and mounts the feed. `ReportCard` gains optional game-label + breakdown-chips display.

**Tech Stack:** Next.js (custom build — see `node_modules/next/dist/docs/`), React client components, TypeScript, `node:test` + `node:assert/strict` run via `tsx --test`, Tailwind, lucide-react, Supabase (real-data mode).

---

## File Structure

- `lib/similarity.ts` (modify) — add `MatchBreakdown`, `calculateMatchBreakdown`, `MatchFilters`, `RigMatch`, `rankAndFilterMatches`. Pure, no IO.
- `lib/similarity.test.ts` (create) — unit tests for the above.
- `lib/data.ts` (modify) — add async `getMatchesForRigAsync(rig, filters)` wrapper.
- `components/report-card.tsx` (modify) — optional `showGame` + `breakdown` props.
- `components/match-feed.tsx` (create) — the feed UI + filter bar + states.
- `components/compatibility-checker.tsx` (modify) — remove game-pill selector + per-game predictions; mount `MatchFeed`.

**Test commands:** single file → `npx tsx --test lib/similarity.test.ts`. Type check → `npx tsc --noEmit`. Lint → `npx eslint <file>`. (Per project memory: do NOT run `next build` against a running dev server; verify with tsc/eslint.)

---

## Task 1: Similarity breakdown (`calculateMatchBreakdown`)

**Files:**
- Modify: `lib/similarity.ts`
- Test: `lib/similarity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/similarity.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateMatchBreakdown, calculateHardwareAwareSimilarity } from './similarity'
import type { Report, UserPC } from './types'

function makeReport(over: Partial<Report>): Report {
  return {
    id: 'r1',
    gameId: 'g1',
    gameName: 'Test Game',
    cpu: 'Ryzen 7 7800X3D',
    gpu: 'RTX 4070',
    ram: 32,
    resolution: '2560x1440',
    settingsPreset: 'High',
    avgFps: 90,
    performanceTier: 'Good',
    createdAt: '2026-01-01T00:00:00.000Z',
    helpfulVotes: 0,
    ...over,
  }
}

const rig: UserPC = { cpu: 'Ryzen 7 7800X3D', gpu: 'RTX 4070', ram: 32, resolution: '2560x1440' }

test('calculateMatchBreakdown: identical hardware buckets as exact', () => {
  const b = calculateMatchBreakdown(makeReport({}), rig)
  assert.equal(b.gpu, 'exact')
  assert.equal(b.cpu, 'exact')
  assert.equal(b.ram, 'exact')
  assert.equal(b.resolution, true)
})

test('calculateMatchBreakdown: unknown hardware buckets as far', () => {
  const b = calculateMatchBreakdown(makeReport({ gpu: 'zzz999', cpu: 'zzz999' }), rig)
  assert.equal(b.gpu, 'far')
  assert.equal(b.cpu, 'far')
})

test('calculateMatchBreakdown: ram diff buckets (exact/close/far)', () => {
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 32 }), rig).ram, 'exact')
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 28 }), rig).ram, 'close')
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 8 }), rig).ram, 'far')
})

test('calculateMatchBreakdown: resolution mismatch is false', () => {
  assert.equal(calculateMatchBreakdown(makeReport({ resolution: '3840x2160' }), rig).resolution, false)
})

test('calculateMatchBreakdown: score equals calculateHardwareAwareSimilarity', () => {
  const r = makeReport({})
  assert.equal(calculateMatchBreakdown(r, rig).score, calculateHardwareAwareSimilarity(r, rig))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/similarity.test.ts`
Expected: FAIL — `calculateMatchBreakdown` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/similarity.ts`, after the existing `calculateHardwareAwareSimilarity` function (before the `rankReportsBySimilarity` block), add:

```ts
export type MatchLevel = 'exact' | 'close' | 'far';

export interface MatchBreakdown {
  score: number;            // same 0–100 as calculateHardwareAwareSimilarity
  gpu: MatchLevel;
  cpu: MatchLevel;
  ram: MatchLevel;
  resolution: boolean;      // same chosen resolution
}

function bucketByPerfDelta(
  reportRaw: string,
  reportCanon: string | undefined,
  userRaw: string,
  userCanon: string | undefined
): MatchLevel {
  const rCanon = reportCanon || normalizeHardwareSync(reportRaw).canonical;
  const uCanon = userCanon || normalizeHardwareSync(userRaw).canonical;
  if (rCanon && uCanon && rCanon === uCanon) return 'exact';

  const rPerf = getPerfIndexForRaw(reportRaw) ?? getPerfIndexForRaw(reportCanon || '');
  const uPerf = getPerfIndexForRaw(userRaw) ?? getPerfIndexForRaw(userCanon || '');
  if (rPerf != null && uPerf != null) {
    const delta = Math.abs(rPerf - uPerf);
    if (delta <= 5) return 'exact';
    if (delta <= 18) return 'close';
    return 'far';
  }
  return 'far';
}

function bucketRam(reportRam: number, userRam: number): MatchLevel {
  const diff = Math.abs(reportRam - userRam);
  if (diff === 0) return 'exact';
  if (diff <= 8) return 'close';
  return 'far';
}

/**
 * Per-component breakdown of how a report's hardware compares to the user's rig.
 * Reuses the same perfIndex-delta signal as calculateHardwareAwareSimilarity so the
 * score and the chips never disagree.
 */
export function calculateMatchBreakdown(report: Report, rig: UserPC): MatchBreakdown {
  return {
    score: calculateHardwareAwareSimilarity(report, rig),
    gpu: bucketByPerfDelta(report.gpu, report.canonicalGpu, rig.gpu, rig.canonicalGpu),
    cpu: bucketByPerfDelta(report.cpu, report.canonicalCpu, rig.cpu, rig.canonicalCpu),
    ram: bucketRam(report.ram, rig.ram),
    resolution: !!report.resolution && report.resolution === rig.resolution,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/similarity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/similarity.ts lib/similarity.test.ts
git commit -m "feat(similarity): add per-component match breakdown"
```

---

## Task 2: Pure ranking + filtering, and the async wrapper

**Files:**
- Modify: `lib/similarity.ts`
- Modify: `lib/data.ts`
- Test: `lib/similarity.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/similarity.test.ts`:

```ts
import { rankAndFilterMatches } from './similarity'

test('rankAndFilterMatches: threshold hides weak matches', () => {
  const strong = makeReport({ id: 'strong' })                                  // identical → high score
  const weak = makeReport({ id: 'weak', gpu: 'zzz999', cpu: 'zzz999', ram: 8 }) // unknown → ~base score
  const out = rankAndFilterMatches([strong, weak], rig, { minScore: 60 })
  assert.deepEqual(out.map((m) => m.report.id), ['strong'])
})

test('rankAndFilterMatches: minScore 0 keeps everything', () => {
  const a = makeReport({ id: 'a' })
  const b = makeReport({ id: 'b', gpu: 'zzz999' })
  const out = rankAndFilterMatches([a, b], rig, { minScore: 0 })
  assert.equal(out.length, 2)
})

test('rankAndFilterMatches: filters by game, resolution, tier', () => {
  const a = makeReport({ id: 'a', gameId: 'g1', resolution: '2560x1440', performanceTier: 'Good' })
  const b = makeReport({ id: 'b', gameId: 'g2', resolution: '3840x2160', performanceTier: 'Excellent' })
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, gameId: 'g1' }).map((m) => m.report.id),
    ['a']
  )
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, resolution: '3840x2160' }).map((m) => m.report.id),
    ['b']
  )
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, tier: 'Excellent' }).map((m) => m.report.id),
    ['b']
  )
})

test('rankAndFilterMatches: sort by fps and newest', () => {
  const slowNew = makeReport({ id: 'slowNew', avgFps: 30, createdAt: '2026-05-01T00:00:00.000Z' })
  const fastOld = makeReport({ id: 'fastOld', avgFps: 200, createdAt: '2026-01-01T00:00:00.000Z' })
  assert.deepEqual(
    rankAndFilterMatches([slowNew, fastOld], rig, { minScore: 0, sort: 'fps' }).map((m) => m.report.id),
    ['fastOld', 'slowNew']
  )
  assert.deepEqual(
    rankAndFilterMatches([slowNew, fastOld], rig, { minScore: 0, sort: 'newest' }).map((m) => m.report.id),
    ['slowNew', 'fastOld']
  )
})

test('rankAndFilterMatches: default sort is match score descending', () => {
  const a = makeReport({ id: 'a' })
  const b = makeReport({ id: 'b', gpu: 'zzz999' })
  const out = rankAndFilterMatches([a, b], rig, { minScore: 0 })
  assert.ok(out[0].score >= out[1].score)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/similarity.test.ts`
Expected: FAIL — `rankAndFilterMatches` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/similarity.ts`, after `calculateMatchBreakdown`, add:

```ts
export type MatchSort = 'match' | 'fps' | 'newest';

export interface MatchFilters {
  gameId?: string;
  resolution?: string;
  tier?: import('./types').PerformanceTier;
  sort?: MatchSort;
  minScore?: number; // default 60
}

export interface RigMatch {
  report: Report;
  score: number;
  breakdown: MatchBreakdown;
}

/**
 * Pure ranking + filtering over an already-fetched report pool.
 * Scores every report, drops those below minScore (default 60), applies the active
 * filters, and sorts. Similarity labels are preserved regardless of sort mode.
 */
export function rankAndFilterMatches(
  reports: Report[],
  rig: UserPC,
  filters: MatchFilters = {}
): RigMatch[] {
  const minScore = filters.minScore ?? 60;

  let matches: RigMatch[] = reports.map((report) => {
    const breakdown = calculateMatchBreakdown(report, rig);
    return { report, score: breakdown.score, breakdown };
  });

  matches = matches.filter((m) => m.score >= minScore);
  if (filters.gameId) matches = matches.filter((m) => m.report.gameId === filters.gameId);
  if (filters.resolution) matches = matches.filter((m) => m.report.resolution === filters.resolution);
  if (filters.tier) matches = matches.filter((m) => m.report.performanceTier === filters.tier);

  const sort = filters.sort ?? 'match';
  matches.sort((a, b) => {
    if (sort === 'fps') return b.report.avgFps - a.report.avgFps;
    if (sort === 'newest') {
      return new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime();
    }
    return b.score - a.score;
  });

  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/similarity.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Add the async wrapper in `lib/data.ts`**

Find the existing `getAllReportsAsync` function (around `lib/data.ts:938`). Immediately after it, add:

```ts
/**
 * Compatibility Match Feed (real-data seam).
 * Fetches the cross-game report pool, then ranks + filters it against the user's rig
 * using the pure engine in lib/similarity.ts. This is the single seam the UI calls; a
 * server-side SQL ranking can replace the body later without touching the feed UI.
 */
export async function getMatchesForRigAsync(
  rig: import('./types').UserPC,
  filters: import('./similarity').MatchFilters = {}
): Promise<import('./similarity').RigMatch[]> {
  const { rankAndFilterMatches } = await import('./similarity')
  const reports = await getAllReportsAsync()
  return rankAndFilterMatches(reports, rig, filters)
}
```

- [ ] **Step 6: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: no new errors.
Run: `npx eslint lib/similarity.ts lib/data.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/similarity.ts lib/similarity.test.ts lib/data.ts
git commit -m "feat(data): add getMatchesForRigAsync ranking seam"
```

---

## Task 3: `ReportCard` — game label + breakdown chips

**Files:**
- Modify: `components/report-card.tsx`

`ReportCard` already shows a "% match to your rig" badge when `similarity > 65`. Add two optional props: `showGame` (render the report's game name) and `breakdown` (render per-part chips). Both default off so existing call sites are unchanged.

- [ ] **Step 1: Extend the props interface**

In `components/report-card.tsx`, change the `ReportCardProps` interface to add the two optional props and import the type:

```ts
import type { MatchBreakdown } from '@/lib/similarity';
```

```ts
interface ReportCardProps {
  report: Report;
  userRig?: UserPC | null;
  onHelpful?: (id: string) => void | Promise<void>;
  onVote?: (id: string, value: 1 | -1 | 0) => void | Promise<void>;
  onViewFull?: (report: Report) => void;
  compact?: boolean;
  /** Show the report's game name (used by the cross-game match feed). */
  showGame?: boolean;
  /** Per-component match breakdown; when present, renders GPU/CPU/RAM match chips. */
  breakdown?: MatchBreakdown;
}
```

And update the destructure:

```ts
export function ReportCard({ report, userRig, onHelpful, onVote, onViewFull, compact = false, showGame = false, breakdown }: ReportCardProps) {
```

- [ ] **Step 2: Render the game label**

Inside the top `<div className="min-w-0 flex-1">` block, as the FIRST child (immediately after the opening tag, before the existing `<div className="flex flex-col gap-1 text-sm">`), add:

```tsx
{showGame && (report.gameName || report.game?.name) && (
  <div className="mb-1 truncate text-xs font-semibold uppercase tracking-wide text-primary">
    {report.gameName || report.game?.name}
  </div>
)}
```

- [ ] **Step 3: Render breakdown chips**

Replace the existing similarity badge block:

```tsx
{isSimilar && (
  <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
    <Zap className="h-3 w-3" /> {similarity}% match to your rig
  </div>
)}
```

with:

```tsx
{(breakdown || isSimilar) && (
  <div className="mt-2 flex flex-wrap items-center gap-1.5">
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
      <Zap className="h-3 w-3" /> {breakdown ? breakdown.score : similarity}% match
    </span>
    {breakdown && (
      <>
        <MatchChip label="GPU" level={breakdown.gpu} />
        <MatchChip label="CPU" level={breakdown.cpu} />
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {report.ram}GB{breakdown.ram === 'exact' ? ' ✓' : ''}
        </span>
      </>
    )}
  </div>
)}
```

- [ ] **Step 4: Add the `MatchChip` helper**

At the bottom of `components/report-card.tsx`, after the `ReportCard` function, add:

```tsx
function MatchChip({ label, level }: { label: string; level: 'exact' | 'close' | 'far' }) {
  const styles: Record<typeof level, string> = {
    exact: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    close: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    far: 'bg-muted/40 text-muted-foreground border-border',
  };
  const text = level === 'exact' ? 'exact' : level === 'close' ? 'close' : 'differs';
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', styles[level])}>
      {label} {text}
    </span>
  );
}
```

- [ ] **Step 5: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: no new errors.
Run: `npx eslint components/report-card.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/report-card.tsx
git commit -m "feat(report-card): optional game label + match breakdown chips"
```

---

## Task 4: `MatchFeed` component

**Files:**
- Create: `components/match-feed.tsx`

A client component that owns filter state, fetches matches via `getMatchesForRigAsync`, and renders the summary line, filter bar, and ranked `ReportCard` list. Handles the empty/looser-match state.

- [ ] **Step 1: Create the component**

Create `components/match-feed.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReportCard } from './report-card';
import { getMatchesForRigAsync } from '@/lib/data';
import type { Game, UserPC, PerformanceTier } from '@/lib/types';
import type { MatchSort, RigMatch } from '@/lib/similarity';
import { Users } from 'lucide-react';

const TIERS: PerformanceTier[] = ['Excellent', 'Good', 'Playable', 'Struggling', 'Unplayable'];
const RESOLUTIONS = ['1920x1080', '2560x1440', '3840x2160'];
const DEFAULT_MIN_SCORE = 60;

interface MatchFeedProps {
  rig: UserPC;
  /** Used to label + populate the game filter dropdown. */
  allGames: Game[];
}

export function MatchFeed({ rig, allGames }: MatchFeedProps) {
  const [gameId, setGameId] = useState<string>('all');
  const [resolution, setResolution] = useState<string>('all');
  const [tier, setTier] = useState<string>('all');
  const [sort, setSort] = useState<MatchSort>('match');
  const [minScore, setMinScore] = useState<number>(DEFAULT_MIN_SCORE);

  const [matches, setMatches] = useState<RigMatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Map gameId -> name for the per-card game label fallback.
  const gameNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of allGames) m.set(g.id, g.name);
    return m;
  }, [allGames]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const result = await getMatchesForRigAsync(rig, {
          gameId: gameId === 'all' ? undefined : gameId,
          resolution: resolution === 'all' ? undefined : resolution,
          tier: tier === 'all' ? undefined : (tier as PerformanceTier),
          sort,
          minScore,
        });
        if (!cancelled) setMatches(result);
      } catch (e) {
        console.warn('[MatchFeed] getMatchesForRigAsync failed', e);
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [rig, gameId, resolution, tier, sort, minScore]);

  const usingLooser = minScore < DEFAULT_MIN_SCORE;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4 text-primary" />
        {loading
          ? 'Finding rigs like yours…'
          : `${matches.length} report${matches.length === 1 ? '' : 's'} from rigs like yours`}
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div>
          <Label className="mb-1 block text-xs">Game</Label>
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All games</SelectItem>
              {allGames.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">Resolution</Label>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              {RESOLUTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">Outcome</Label>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              {TIERS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs">Sort</Label>
          <Select value={sort} onValueChange={(v) => setSort(v as MatchSort)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Best match</SelectItem>
              <SelectItem value="fps">Highest FPS</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-border bg-muted/30" />
          ))}
        </div>
      ) : matches.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {matches.map((m) => (
            <ReportCard
              key={m.report.id}
              report={{ ...m.report, gameName: m.report.gameName || gameNameById.get(m.report.gameId) }}
              userRig={rig}
              breakdown={m.breakdown}
              showGame
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          <p>No {usingLooser ? '' : 'close '}matches yet for this filter combination.</p>
          {!usingLooser && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setMinScore(0)}>
              Show looser matches
            </Button>
          )}
          {usingLooser && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => setMinScore(DEFAULT_MIN_SCORE)}>
              Back to close matches only
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: no new errors.
Run: `npx eslint components/match-feed.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/match-feed.tsx
git commit -m "feat(match-feed): ranked cross-game match feed with filters"
```

---

## Task 5: Wire `MatchFeed` into the compatibility checker

**Files:**
- Modify: `components/compatibility-checker.tsx`

Remove the manual game-pill selector, the `predictions` state, the predictions `useEffect`, and the per-game prediction render block. Mount `MatchFeed` when a rig is saved. Keep the rig form and the `allGames` load (now feeds the game filter).

- [ ] **Step 1: Update imports**

In `components/compatibility-checker.tsx`:
- Add: `import { MatchFeed } from '@/components/match-feed';`
- Remove these now-unused imports: `PerformanceBadge` (from `./performance-badge`), `ReportCard` (from `./report-card`), and from the `@/lib/data` import block remove `predictForUserRigAsync` and `getReportsForGameAsync` (keep `loadMyRigAsync`, `saveMyRigAsync`, `clearMyRigAsync`, `getAllGames`).
- Remove `cn` only if it becomes unused after Step 4 (it is used by the game pills being deleted — verify and remove from the import if no longer referenced).

- [ ] **Step 2: Remove predictions state**

Delete the `selectedGames` state line and the entire `predictions` state block:

```tsx
const [selectedGames, setSelectedGames] = useState<string[]>(preselectedGameSlug ? [preselectedGameSlug] : []);
```

```tsx
const [predictions, setPredictions] = useState<Array<{
  game: Game;
  prediction: Awaited<ReturnType<typeof predictForUserRigAsync>> | null;
  sampleReports: Awaited<ReturnType<typeof getReportsForGameAsync>>;
}>>([]);
```

- [ ] **Step 3: Remove the predictions `useEffect`**

Delete the entire second `useEffect` (the one with the comment "Recompute predictions whenever rig, selection, or games list changes." — the `recomputePredictions` block, from `useEffect(() => {` through its closing `}, [myRig, selectedGames, allGames]);`).

- [ ] **Step 4: Remove `toggleGame` and the predictions/game-selector JSX**

Delete the `toggleGame` function:

```tsx
const toggleGame = (slug: string) => {
  setSelectedGames((prev) =>
    prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
  );
};
```

In `clearRig`, delete the line `setPredictions([]);` and the line `setSelectedGames([]);` if present.

Delete the entire `{/* Game selector */}` block (the `<div>` containing `Check these games`) and the entire `{/* Results … */}` block (`{myRig && predictions.length > 0 && ( … )}`).

- [ ] **Step 5: Mount the feed**

Where the deleted `{/* Results */}` block was (still inside `<CardContent>`, before the loading/empty-state blocks), insert:

```tsx
{myRig && <MatchFeed rig={myRig} allGames={allGames} />}
```

Keep the existing `!myRig && !isLoading` empty-state prompt below it.

- [ ] **Step 6: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: no new errors. If tsc reports an unused `Game` import or `cn`, remove it.
Run: `npx eslint components/compatibility-checker.tsx`
Expected: clean (no `no-unused-vars`).

- [ ] **Step 7: Commit**

```bash
git add components/compatibility-checker.tsx
git commit -m "feat(compatibility): replace game pills with auto match feed"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit-test suite**

Run: `npm test`
Expected: all tests pass, including the new `lib/similarity.test.ts`.

- [ ] **Step 2: Type check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint touched files**

Run: `npx eslint lib/similarity.ts lib/data.ts components/report-card.tsx components/match-feed.tsx components/compatibility-checker.tsx`
Expected: clean.

- [ ] **Step 4: Manual smoke test (dev server already running, or start with `npm run dev`)**

In the browser at `/compatibility`:
- Save a rig (e.g. CPU `Ryzen 7 7800X3D`, GPU `RTX 4070`, 32 GB, 2560x1440).
- Confirm the feed appears automatically (no game-pill clicking) with cards showing a game label, a match %, and GPU/CPU/RAM chips, ordered best-match first.
- Change each filter (game, resolution, outcome, sort) and confirm the feed updates.
- Pick a filter combination with no results and confirm the "Show looser matches" button appears and, when clicked, reveals weaker matches.
- Clear the rig and confirm the feed disappears and the "Save your rig" prompt returns.

- [ ] **Step 5: Final commit (if any verification fixups were made)**

```bash
git add -A
git commit -m "chore(compatibility): verification fixups for match feed"
```

---

## Notes for the implementer

- This is a custom Next.js build. If you touch routing/data-fetching conventions, read the relevant guide under `node_modules/next/dist/docs/` first. This plan only adds client components + pure lib functions, so standard React patterns apply.
- Do NOT run `next build` against a running dev server (project memory: it serves stale pages). Verify with `tsc`/`eslint`/`npm test` instead.
- The app is in real-data mode (`NEXT_PUBLIC_USE_REAL_DATA=true`); the feed reads live Supabase reports through `getAllReportsAsync()`. If the database has few reports, the feed may legitimately be sparse — use "Show looser matches" during the smoke test.
```
