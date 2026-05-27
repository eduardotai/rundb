# Tier 1 Visual Polish — Surface Elevation & Interaction Specification

**Role**: Agent 2 — Surface Depth & Interaction Lead  
**Swarm**: Approved Tier 1 Visual Polish  
**Status**: Single Source-of-Truth (SSOT) for Phase B builder agents  
**Date**: 2026-05-26  
**Sacred Constraints Observed**:
- Only candidates #2, #3, #4, #6, #7 from the approved plan.
- Pure natural higher-craft evolution of the existing ProtonDB-inspired dark theme (deep navy `#0a0f1c` background, `#111827` cards, `#1e293b` borders, cyan `#67e8f9` primary, semantic tier colors).
- Zero new visual metaphors (no glassmorphism, no heavy gradients, no 3D extrusions, no colored backdrops).
- Information density and scannability fully preserved (no reduced contrast, no layout shift, no text opacity fades on hover).
- Leverages and strictly extends existing patterns: current `.report-card` hover (translateY + border + shadow), GameCard image `group-hover:scale`, `.card` base transition, tier badge classes (`.badge-excellent` etc.), rounded-2xl language, and ProtonDB data-dense aesthetic.

**Deliverable Purpose**: Builder agents in Phase B must be able to implement *directly* from this document with zero ambiguity. Every value, class string, file path, and line reference is explicit.

---

## 1. Visual Elevation Language (The "What" — Precise & Actionable)

### 1.1 Core Principles (Non-Negotiable)
- **Quiet premium lift**: Cards feel substantial and alive on interaction but remain calm and data-focused.
- **Tier awareness without dominance**: When a surface carries a PerformanceTier (dominant or primary), hover reveals a *restrained* tinted rim (1px effective) using the tier color at ~18% opacity. Never overrides text or data.
- **Inner highlight as shadow craft**: Achieved exclusively via `inset` component of box-shadow (top-edge 3.5% white) — no extra DOM, no pseudo-elements that risk stacking issues.
- **Motion**: 200ms premium cubic (slightly snappy but buttery). All transforms + shadows use the same timing. Images use 300ms for breathing room.
- **Reduced motion**: All elevation rules are automatically neutralized via existing Tailwind + explicit `@media (prefers-reduced-motion: reduce)` guards in the new CSS.
- **Scannability first**: FPS numbers, similarity pills, hardware lines, and badges never change opacity, weight, or position on hover. Only container lift + shadow + border + rim.

### 1.2 New CSS Tokens & Standards (Add to `app/globals.css`)

Insert the following block **immediately after the existing tier color variables** (after line 35, before `--radius`).

```css
  /* ============================================================
     TIER 1 VISUAL POLISH — SURFACE ELEVATION SYSTEM
     Natural higher-craft evolution of existing ProtonDB dark theme.
     Used by: .card, .report-card, GameCard, report banner rows, stats surfaces.
     ============================================================= */

  /* Hover transition standard (single source of truth) */
  --transition-hover: 200ms cubic-bezier(0.23, 1, 0.32, 1);
  --transition-image: 300ms cubic-bezier(0.23, 1, 0.32, 1);

  /* Base + elevated shadows (evolution of current inline rgb shadows) */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.15), 0 2px 4px -2px rgb(0 0 0 / 0.1);

  /* Primary hover elevation (used for all interactive primary cards) */
  --shadow-card-hover: 0 12px 20px -4px rgb(0 0 0 / 0.32),
                       0 4px 6px -2px rgb(0 0 0 / 0.2),
                       inset 0 1px 0 rgba(255, 255, 255, 0.035);

  /* Stronger variant for large banner-style rows (reports page) */
  --shadow-card-hover-xl: 0 16px 28px -6px rgb(0 0 0 / 0.36),
                          0 6px 8px -3px rgb(0 0 0 / 0.22),
                          inset 0 1px 0 rgba(255, 255, 255, 0.04);

  /* Tier-tinted rim colors (restrained, 18% opacity for hover only) */
  --rim-excellent: rgba(34, 197, 94, 0.18);
  --rim-good: rgba(59, 130, 246, 0.18);
  --rim-playable: rgba(234, 179, 8, 0.18);
  --rim-struggling: rgba(249, 115, 22, 0.18);
  --rim-unplayable: rgba(239, 68, 68, 0.18);
```

### 1.3 Updated Base Rules (Replace / Extend Existing)

Replace the current `.card` and `.report-card` blocks (lines 50-66) with the enhanced versions below. This is the foundation for Candidate #2.

```css
/* Premium data-dense component polish — EVOLVED */
.card {
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-hover), border-color 180ms ease, box-shadow var(--transition-hover);
}

.card:hover {
  transform: translateY(-2px);
  border-color: #475569;
  box-shadow: var(--shadow-card-hover);
}

/* ReportCard — the heart of the product. Stronger evolution of original -1px lift. */
.report-card {
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-hover), border-color 180ms ease, box-shadow var(--transition-hover);
}

.report-card:hover {
  transform: translateY(-2px);
  border-color: #475569;
  box-shadow: var(--shadow-card-hover);
}

/* Tier-tinted rim on hover (only when data-tier present — see Change Catalog) */
.report-card[data-tier="Excellent"]:hover {
  box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-excellent);
}
.report-card[data-tier="Good"]:hover {
  box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-good);
}
.report-card[data-tier="Playable"]:hover {
  box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-playable);
}
.report-card[data-tier="Struggling"]:hover {
  box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-struggling);
}
.report-card[data-tier="Unplayable"]:hover {
  box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-unplayable);
}

/* Reduced motion safety (applies to all new elevation) */
@media (prefers-reduced-motion: reduce) {
  .card,
  .report-card,
  .game-card-surface,
  .report-banner-row {
    transform: none !important;
    transition: none !important;
    box-shadow: var(--shadow-sm) !important;
  }
}
```

### 1.4 GameCard / Banner Row Image & Surface Rules (Add New)

Add these new rules at the end of globals.css (after the error toast block).

```css
/* GameCard image treatment evolution + tier rim support */
.game-card-surface {
  transition: transform var(--transition-hover), border-color 180ms ease, box-shadow var(--transition-hover);
}

.game-card-surface:hover {
  transform: translateY(-2px);
  border-color: #475569;
  box-shadow: var(--shadow-card-hover);
}

/* Tier rim for GameCard (dominant tier) */
.game-card-surface[data-tier="Excellent"]:hover { box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-excellent); }
.game-card-surface[data-tier="Good"]:hover     { box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-good); }
.game-card-surface[data-tier="Playable"]:hover { box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-playable); }
.game-card-surface[data-tier="Struggling"]:hover { box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-struggling); }
.game-card-surface[data-tier="Unplayable"]:hover { box-shadow: var(--shadow-card-hover), 0 0 0 1px var(--rim-unplayable); }

/* Image scale — consistent 1.04 breathing (evolution from 1.03 / 1.035) */
.game-card-surface .cover-image,
.report-banner-row .cover-image {
  transition: transform var(--transition-image);
}
.game-card-surface:hover .cover-image,
.report-banner-row:hover .cover-image {
  transform: scale(1.04);
}

/* Reports page banner rows (large horizontal game surfaces) — stronger shadow */
.report-banner-row {
  transition: transform var(--transition-hover), border-color 180ms ease, box-shadow var(--transition-hover);
}
.report-banner-row:hover {
  transform: translateY(-2px);
  border-color: #475569;
  box-shadow: var(--shadow-card-hover-xl);
}
.report-banner-row[data-tier="Excellent"]:hover { box-shadow: var(--shadow-card-hover-xl), 0 0 0 1px var(--rim-excellent); }
.report-banner-row[data-tier="Good"]:hover     { box-shadow: var(--shadow-card-hover-xl), 0 0 0 1px var(--rim-good); }
.report-banner-row[data-tier="Playable"]:hover { box-shadow: var(--shadow-card-hover-xl), 0 0 0 1px var(--rim-playable); }
.report-banner-row[data-tier="Struggling"]:hover { box-shadow: var(--shadow-card-hover-xl), 0 0 0 1px var(--rim-struggling); }
.report-banner-row[data-tier="Unplayable"]:hover { box-shadow: var(--shadow-card-hover-xl), 0 0 0 1px var(--rim-unplayable); }
```

### 1.5 PerformanceBadge Hover Energy (Add at end of badge rules)

Add after the existing `.badge-unplayable` block (~line 102).

```css
/* PerformanceBadge — hover energy (subtle glow + border pop, tier-respecting) */
.badge-excellent:hover {
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22);
  border-color: #166534;
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
.badge-good:hover {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22);
  border-color: #1e40af;
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
.badge-playable:hover {
  box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.22);
  border-color: #713f12;
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
.badge-struggling:hover {
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.22);
  border-color: #9a3412;
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
.badge-unplayable:hover {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.22);
  border-color: #991b1b;
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
```

### 1.6 ReportCard Internal Micro-Interactions (FPS, Similarity, Heart, Expanded)

Add these targeted rules at the end of globals.css:

```css
/* FPS hero block — subtle pop on card hover (no layout shift, preserves density) */
.report-card:hover .fps-hero {
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}

/* Similarity pill — gentle lift + stronger emerald on card hover */
.report-card:hover .similarity-pill {
  transform: translateY(-0.5px);
  background: rgba(16, 185, 129, 0.14);
}

/* Heart / upvote button micro energy */
.report-card .helpful-heart {
  transition: transform 120ms ease, color 120ms ease;
}
.report-card .helpful-heart:hover {
  transform: scale(1.15);
}
.report-card .helpful-heart:active {
  transform: scale(0.95);
}

/* Expanded details panel — quiet elevation on open (already good, just polish) */
.report-card .expanded-details {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
  border: 1px solid #334155;
}
```

---

## 2. Change Catalog (Exact, Line-Referenced, Copy-Paste Ready)

### Candidate #2: Primary Card Elevation (.card, .report-card, base surfaces)

**File: `app/globals.css`**
- **Action**: Insert the full token block (Section 1.2) after line 35.
- **Action**: Replace the entire `.card` + `.report-card` blocks (current lines 50-66) with the evolved versions in Section 1.3.
- **Action**: Add the reduced-motion guard from Section 1.3.

**File: `components/report-card.tsx`**
- **Line 54-58** (root div):
  **Before**:
  ```tsx
  <div
    className={cn(
      'report-card group cursor-pointer rounded-2xl border border-border bg-card p-4 md:p-5',
      'hover:border-slate-600/70',
      compact && 'p-3 md:p-4'
    )}
  ```
  **After** (exact):
  ```tsx
  <div
    className={cn(
      'report-card group cursor-pointer rounded-2xl border border-border bg-card p-4 md:p-5',
      compact && 'p-3 md:p-4'
    )}
    data-tier={report.performanceTier}
  ```
  (Removed the duplicate `hover:border-slate-600/70` — now handled centrally in globals + stronger tier rim.)

**File: `components/ui/card.tsx`** (for consistency on shadcn Card surfaces)
- **Line 12**: Add `shadow-sm` is already present. Builders should also apply `card` className when using `<Card className="card">` for interactive or elevated instances. No breaking change.

**Files using generic card surfaces** (apply `className="card"` or the new hover classes):
- `app/games/[slug]/page.tsx:247` (official requirements)
- `app/games/[slug]/page.tsx:275` (community stats)
- `app/page.tsx:163` (trust bar — static, use base only)
- `app/profile/page.tsx:18`

### Candidate #3: GameCard (image hover, overlays, tier rim)

**File: `components/game-card.tsx`**
- **Line 48** (Link root):
  **Before**:
  ```tsx
  'group block overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-lg',
  ```
  **After** (exact):
  ```tsx
  'game-card-surface group block overflow-hidden rounded-2xl border border-border bg-card',
  ```
  (Removes old transition + hover — now powered by globals + data-tier.)

- **Line 61** (Image):
  **Before**:
  ```tsx
  className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
  ```
  **After**:
  ```tsx
  className="cover-image object-cover object-top transition-transform group-hover:scale-[1.04]"
  ```
  (Note: duration now controlled by --transition-image.)

- **Add after line 38** (after dominantTier calculation):
  ```tsx
  // For data-tier rim on hover (Candidate #3)
  const hasDominantTier = !!dominantTier;
  ```
- **Line 45-50** (Link): Add `data-tier={dominantTier}` (conditional):
  ```tsx
  <Link
    ...
    className={cn(...)}
    data-tier={dominantTier}
  >
  ```

**File: `app/reports/page.tsx`** (banner rows treated as GameCard surfaces)
- **Line 206**:
  **Before**:
  ```tsx
  className="group flex overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-slate-600/70 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
  ```
  **After**:
  ```tsx
  className="report-banner-row group flex overflow-hidden rounded-2xl border border-border bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
  data-tier={dominantTier}
  ```
- **Line 217** (Image inside banner):
  **Before**: `... group-hover:scale-[1.035]`
  **After**: `... cover-image group-hover:scale-[1.04]`

**File: `app/games/[slug]/page.tsx`** (hero cover container — static depth only, no hover lift)
- Keep current (no `game-card-surface`). Add subtle base shadow if desired: `shadow-sm`.

### Candidate #4: PerformanceBadge (hover energy)

**File: `components/performance-badge.tsx`**
- **No structural TSX change required** (energy is pure CSS).
- Optional enhancement (recommended for strong energy): wrap content or accept that direct `:hover` on the badge itself triggers the glow defined in globals.css Section 1.5.
- When used inside a hovered `.report-card` or `.game-card-surface`, the badge automatically receives the rim benefit via parent. Direct hover adds the glow for "energy" micro-delight.

**Usage sites that benefit automatically** (no change needed):
- All `PerformanceBadge` in `report-card.tsx`, `game-card.tsx`, `app/games/[slug]/page.tsx`, `app/reports/page.tsx`, `components/compatibility-checker.tsx`.

### Candidate #6: ReportCard Internals (FPS block, similarity, expanded state, heart)

**File: `components/report-card.tsx`**
- **FPS block (lines 98-111)**: Wrap the hero numbers in a span/div with class `fps-hero`:
  ```tsx
  <div className="mt-3 flex items-baseline gap-3 fps-hero">
    ...
  ```
- **Similarity indicator (lines 121-125)**: Add class `similarity-pill`:
  ```tsx
  <div className="mt-2 inline-flex ... similarity-pill">
  ```
- **Heart button (lines 132-143)**: Add class `helpful-heart` to the Heart icon or its immediate wrapper:
  ```tsx
  <Heart className={cn('h-3.5 w-3.5 helpful-heart', ...)} />
  ```
- **Expanded details (line 165)**: Add class `expanded-details`:
  ```tsx
  <div className="mt-3 space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm expanded-details">
  ```

**CSS support**: All powered by the new rules in globals.css Section 1.6 (no additional TSX beyond the classNames above).

### Candidate #7: Cross-Surface Consistency, Tier Rims, & Future Surfaces

**New helper (recommended, non-breaking)** — Add to `lib/utils.ts` (or create small `lib/tier.ts`):
```ts
export function getTierRimColor(tier: PerformanceTier): string {
  const map: Record<PerformanceTier, string> = {
    Excellent: 'var(--rim-excellent)',
    Good: 'var(--rim-good)',
    Playable: 'var(--rim-playable)',
    Struggling: 'var(--rim-struggling)',
    Unplayable: 'var(--rim-unplayable)',
  };
  return map[tier];
}
```
(Use only if dynamic inline styles are ever required; attribute selectors are preferred for performance.)

**Files that must receive data-tier for rim support (Candidate #7 scope)**:
- `app/games/[slug]/page.tsx` lines 315 (PerformanceBadge inside stats) — stats rows are not full cards; leave as-is.
- All future surfaces using ReportCard or GameCard automatically inherit via the component changes above.

**Additional surfaces to harden for consistency (apply `card` class + data-tier where tier known)**:
- `app/compatibility/page.tsx` and embedded checker prediction cards (rounded-xl border bg-background p-4 → add `card`).
- Any future "RigHealthCard", "Plausibility" surfaces (per planner docs) must follow this spec.

**No changes required** for:
- Tables (admin, etc.)
- Buttons, inputs, dialogs (scoped to cards/surfaces only)
- Skeleton states (they already mimic final rounded-2xl + border)

---

## 3. Before / After Examples (Most Visible Surfaces)

### 3.1 Home Trending Grid (6-col GameCards on `/`)
**Before (visual)**: Cards sit flat. Hover produces thin border change + modest `shadow-lg` + 3% image zoom. Very subtle lift on some.

**After (visual)**: 
- Entire card lifts exactly 2px.
- Shadow becomes rich directional + soft white inset top highlight (feels expensive but still dark-theme native).
- Dominant tier produces a clean 1px colored rim glow on hover (Excellent = soft green, etc.).
- Cover art breathes to 1.04× with silky 300ms motion.
- Title still transitions to primary cyan. Report count pill and badge remain perfectly scannable.
- Result: 6-card grid feels like a living catalog while remaining extremely dense.

**Exact class delta**: See Candidate #3.

### 3.2 Reports List (Vertical ReportCard stack on `/games/[slug]`)
**Before**: Subtle -1px lift, light shadow, border to #475569. No tier personality on hover.

**After**:
- 2px lift + premium `--shadow-card-hover`.
- FPS numbers (the giant tabular numbers) receive a soft text-shadow pop.
- Similarity emerald pill gently rises and deepens.
- Heart icon scales on hover for delightful micro-feedback.
- The entire card acquires the exact tier-colored rim (e.g. a Struggling report gets a warm orange 1px halo).
- Expanded "Details" panel feels more contained with subtle inner top highlight.
- Density unchanged — user still scans 8+ reports in <3 seconds.

**Exact class + data-tier + internal class deltas**: See Candidates #2 and #6.

### 3.3 Game Detail Page (Stats cards + Requirements card + hero)
**Before**: Static rounded-2xl border bg-card. Hero is flat image container.

**After**:
- Stats and requirements cards use `.card` → gain base shadow + full hover elevation (lift + rich shadow + inset highlight) when the user mouses over them (they become "live" data surfaces).
- Hero container stays static (correct — it is not interactive data).
- When reports load below, the ReportCards deliver the full tier-rim experience.
- Overall page now has clear visual hierarchy of "surfaces you can lean on."

---

## 4. Consistency Rules for All Future Surfaces (Phase B and Beyond)

1. **Token usage only**: All shadows, transitions, rim colors, and hover lifts must come from the new CSS variables. No new hard-coded `rgb(0 0 0 / 0.x)` or `translateY(-Npx)` or `scale-[1.0N]` on card surfaces.
2. **data-tier contract**: Any surface whose primary data is a PerformanceTier (or has a dominant tier) **must** render `data-tier="Excellent" | "Good" | ...` on the root interactive element to receive the rim treatment.
3. **Image rule**: All cover art uses `.cover-image` class + `group` on ancestor + `group-hover:scale-[1.04]`. Never scale the card container itself.
4. **ReportCard is sacred**: Always pass through the component changes in Candidate #6. Never duplicate its internal structure without the micro classes.
5. **No layout shift**: All hovers use `transform: translateY` + `box-shadow` only. Never `margin`, `padding`, or `scale` on text blocks.
6. **Accessibility**: All new hovers maintain or improve contrast. Focus rings (already present via `focus-visible:ring-primary/60`) remain untouched.
7. **Mobile**: On touch devices the hover states are acceptable as "pressed" feedback. No special tap scaling required beyond existing.
8. **Future surfaces checklist** (for any new component):
   - Root element gets `rounded-2xl border border-border bg-card` (or `bg-background` only when intentionally recessed).
   - Add `card` or `game-card-surface` / `report-banner-row` class.
   - Add `data-tier` when applicable.
   - Use existing PerformanceBadge / ReportCard primitives.
   - Test scannability at 3ft (desktop) and 1ft (mobile).

---

## 5. Implementation Notes for Phase B Builders

- **Order of work**: globals.css tokens & rules first → component data-tier + className updates → verify on home trending → game detail reports → reports page banners → all other usages.
- **Testing matrix** (minimum):
  - All 5 tiers on hover (rim visibility).
  - Reduced-motion preference.
  - Real data (flag=true) and mock.
  - 6-col home grid, 2-col/3-col games grid, vertical reports, horizontal reports banners.
  - Dark theme only (no light mode exists).
- **Rollback safety**: All changes are additive or direct replacements of hover strings. Reverting to previous hover classes instantly restores old behavior.
- **Performance**: Pure CSS. Zero JS cost. Attribute selectors are fast.
- **Questions during build**: Escalate to Agent 2 (this spec) before deviating.

---

**This document is the authoritative reference.** Any implementation that deviates from the exact values, classes, or rules herein is out of scope for Tier 1 Visual Polish.

**End of Specification** — Ready for Phase B execution.
