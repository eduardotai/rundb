# Compatibility Match Feed — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Area:** `app/compatibility`, `components/compatibility-checker.tsx`, `lib/data.ts`, `lib/similarity.ts`

## Problem

The compatibility page lets a user enter their hardware but feels inert. Two gaps:

1. Nothing happens automatically — the user must manually click game pills to see anything.
2. The "similar reports" shown are not actually similar — the code grabs the 3 most *recent* reports per game (`reports.slice(0, 3)`), ignoring hardware. A working `rankReportsBySimilarity()` exists in `lib/similarity.ts` but is never called by the page.

## Goal

After a user saves their hardware, automatically show a single ranked feed of the closest-matching reports **across all games**, sorted by how close each reporter's rig is to theirs. Answers: *"Who has a rig like mine, and what did they get?"*

## Decisions (from brainstorming)

- **Core experience:** Auto best-match feed (no manual game-picking required).
- **Feed shape:** Flat list of individual reports across all games, ranked by hardware similarity.
- **Match quality:** Threshold + match %. Only show reports above a "close enough" bar (similarity ≥ 60) by default; label each with a match score and which parts match (GPU/CPU/RAM). Weak matches hidden by default, with a one-tap escape hatch to loosen.
- **Filters:** game, resolution, performance tier, and a sort toggle (Best match / Highest FPS / Newest).
- **Per-game prediction blocks:** fully removed. Narrowing to a single game is handled by the game filter instead.

## Architecture

Chosen approach: **client-side ranking behind a clean data-layer seam** (so a server-side SQL/RPC ranking can replace it later without touching the UI).

App runs in real-data mode (`NEXT_PUBLIC_USE_REAL_DATA=true`); reports come from Supabase via `getAllReportsAsync()` (200-report cap — acceptable at current scale).

### 1. Data layer — `getMatchesForRigAsync(rig, filters)`

New function in `lib/data.ts`. Single seam between UI and the ranking engine.

- Input: `UserPC` rig + `MatchFilters { gameId?, resolution?, tier?, sort, minScore }`.
- Pulls the report pool via existing `getAllReportsAsync()`.
- Scores each report with the similarity engine, attaches a breakdown.
- Applies threshold (`minScore`, default 60) and active filters.
- Sorts by the chosen mode (Best match = score desc; Highest FPS = avgFps desc; Newest = createdAt desc) — similarity labels remain visible regardless of sort.
- Returns `Array<{ report: Report; score: number; breakdown: MatchBreakdown }>`.
- UI never calls the similarity engine directly.

### 2. Similarity breakdown — `lib/similarity.ts`

New `calculateMatchBreakdown(report, rig): MatchBreakdown` where:

```ts
interface MatchBreakdown {
  score: number;                       // same 0–100 as calculateHardwareAwareSimilarity
  gpu: 'exact' | 'close' | 'far';
  cpu: 'exact' | 'close' | 'far';
  ram: 'exact' | 'close' | 'far';
  resolution: boolean;                 // same chosen resolution
}
```

- Reuses the existing perfIndex-delta logic. Buckets: `exact` = same canonical / delta ≤ 5; `close` = delta within the existing "similar" bands; `far` otherwise.
- `calculateHardwareAwareSimilarity` stays unchanged (backward compat for existing call sites). The breakdown derives `score` from it.

### 3. UI — `components/compatibility-checker.tsx` + new `MatchFeed`

- **Rig form:** kept as-is (CPU/GPU/RAM/resolution inputs, detection, save/clear). It works.
- **Removed:** the manual game-pill selector and the per-game prediction blocks (`predictForUserRigAsync` loop, `PerformanceBadge` per-game, `recommendedSettings`).
- **New `MatchFeed` component** (`components/match-feed.tsx`):
  - Summary line: "N reports from rigs like yours."
  - Filter bar: game ▾ · resolution ▾ · tier ▾ · sort toggle (Best match / Highest FPS / Newest).
  - Ranked list of `ReportCard`s. Each card needs:
    - **Game label** (report `gameName` / `game.name`) — `ReportCard` currently does not show the game; add an optional `showGame` affordance.
    - **Match % + matching-part chips** (e.g. `GPU exact · CPU close · 32GB`) driven by `MatchBreakdown`. `ReportCard` already renders a "% match" badge when similarity > 65; extend to accept/display the breakdown chips.
  - Re-fetches matches when rig or filters change (mirrors existing `useEffect` recompute pattern).

### 4. States

- **No rig saved:** existing prompt to enter hardware.
- **Rig saved, matches ≥ threshold:** the feed.
- **Rig saved, zero matches ≥ threshold but reports exist:** "No close matches yet" + one-tap "Show looser matches" that drops `minScore` (e.g. to 0). The page is never empty when reports exist.
- **Loading:** skeletons (existing loading-state patterns).
- **Error:** graceful fallback consistent with existing data-layer try/catch + console.warn behavior.

### 5. Testing

- Unit tests for `calculateMatchBreakdown`: exact/close/far bucketing per component, threshold edges, missing-perfIndex fallback path. Follows existing `lib/*.test.ts` pattern.
- Unit tests for the filter + sort logic in `getMatchesForRigAsync` (pure portions): threshold filtering, each sort mode, each filter dimension. Pool fetch is mocked; no live-DB tests.

## Out of scope (YAGNI)

- No DB migration, no new report columns, no server-side RPC (left as a future swap behind the seam).
- No pagination beyond the existing 200-report pool cap.
- No saved/persisted filter state across sessions.
- No changes to report submission or voting.

## Reuse

- `getAllReportsAsync()` (report pool), the similarity engine, `ReportCard`, `PerformanceBadge`, existing loading/error patterns and `*.test.ts` conventions.
