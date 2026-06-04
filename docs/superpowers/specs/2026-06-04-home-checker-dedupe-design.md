# Home-page checker de-duplication

**Date:** 2026-06-04
**Status:** Approved

## Problem

The home page (`app/page.tsx`) exposes the compatibility checker three ways at once:

1. Hero **"Check My PC"** button → links to `/compatibility`.
2. **"Full checker"** ghost link in the "Check your rig" section header → also links to `/compatibility`.
3. The **embedded `<CompatibilityChecker embedded />`** rendered inline below the hero, which is the same component (rig form + MatchFeed "reports from rigs like yours") that the `/compatibility` ("Will It Run?") page renders.

Three entry points for one tool, with the full tool duplicated inline on home and on its own page.

## Decision

- The home page **links out**; `/compatibility` ("Will It Run?") is the single home of the full checker + match feed.
- Below the hero, the removed section is **not replaced** — home flows hero → Trending → How RunDB works.

## Change (scope: `app/page.tsx` only)

- Remove the entire **"Check your rig"** block: the `<div className="mb-16">` containing the section header, the "Full checker" ghost link, and `<CompatibilityChecker embedded />`.
- Remove the now-unused `import { CompatibilityChecker } from '@/components/compatibility-checker'`.
- Keep the hero (with its single "Check My PC" → `/compatibility` CTA), Trending, and How RunDB works. `ArrowRight` remains imported (still used by Trending).

## Out of scope

- `app/compatibility/page.tsx` and `components/compatibility-checker.tsx` are untouched; that page stays the single home of the checker.
- Side effect: the `embedded` prop on `CompatibilityChecker` becomes unused. Left in place to avoid unrelated refactoring.

## Verification

- `npx tsc --noEmit` and `npx eslint app/page.tsx` clean (no orphaned imports). No `next build` against the running dev server (serves stale pages).
- Visual: home renders hero → Trending → How RunDB works; the only checker entry point is the hero CTA.
