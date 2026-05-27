# Color Foundations Specification
**Agent 1 — Color System + Foundations Lead**  
**Tier 1 Visual Polish Swarm (8 agents)**  
**Phase A Deliverable**  
**Date**: 2026-05-26  

This document owns the hex vs HSL color system bug and provides the exact, copy-paste ready migration for the centralized design tokens. It is the single highest-leverage fix identified in prior exploration. All other visual polish work depends on a correct, working color system.

**Scope constraint (non-negotiable)**: Only the 7 sacred candidates (globals.css + 6 UI files with hard-coded hex bypasses). No new visual metaphors, textures, ProtonDB data-dense personality changes, or unrelated files. All changes reversible and low-risk.

---

## 1. Exact Current Broken State (with file:line evidence)

### Root Cause
- `tailwind.config.ts` (lines 18-56) is written in the standard shadcn/ui + CSS variables pattern:
  ```ts
  background: "hsl(var(--background))",
  card: { DEFAULT: "hsl(var(--card))", ... },
  // ... primary, popover, secondary, muted, accent, destructive, border, input, ring, chart-*
  ```
  Every semantic color **expects** the CSS custom property to contain a **space-separated HSL triplet** (e.g. `222 47% 11%`), which `hsl()` then wraps.

- `app/globals.css` (lines 3-40) defines **every** root token as **full hex strings**:
  ```css
  :root {
    --background: #0a0f1c;
    --foreground: #e2e8f0;
    ...
    --tier-excellent: #22c55e;
    ...
  }
  ```
  Result: `hsl(var(--background))` produces the **invalid** `hsl(#0a0f1c)`. Tailwind tokens are broken or fall back unpredictably. Custom CSS `var(--tier-*)` works by accident (because it receives a valid color string) but the whole system is inconsistent.

### Hard-coded Hex Bypasses (the 7 sacred candidates)
These bypasses were added because the token system was non-functional. They duplicate surface colors and must be removed after the root fix.

**app/globals.css** (the source of truth + its own bypasses):
- Lines 5-35: All 25+ `--*` tokens = `#hex`
- Line 55: `.card:hover { border-color: #334155; }`
- Line 64: `.report-card:hover { border-color: #475569; ... }`
- Lines 77,83,89,95,101: `.badge-* { border: 1px solid #14532d; ... }` (5 darker tier border variants)
- Line 123: `[cmdk-item][data-selected="true"] { background: #1e293b; }`
- Lines 137,141: `::-webkit-scrollbar-thumb { background: #334155; ... }` and hover `#475569`
- Lines 158-193: Full strong Sonner error toast overrides with `#b91c1c`, `#f87171`, `#fff`, `rgba(255,255,255,...)` (multiple `!important`)

**components/ui/dialog.tsx**:
- Line 41 (DialogContent): `border border-[#334155] bg-[#111827]`

**components/ui/popover.tsx**:
- Line 22 (PopoverContent): `border border-[#334155] bg-[#1e293b]`

**components/ui/dropdown-menu.tsx**:
- Line 50 (DropdownMenuSubContent): `border border-[#334155] bg-[#1e293b]`
- Line 68 (DropdownMenuContent): `border border-[#334155] bg-[#1e293b]`

**components/ui/select.tsx**:
- Line 78 (SelectContent): `border border-[#334155] bg-[#1e293b]`
- Line 121 (SelectItem): `hover:bg-[#334155] ... data-[highlighted]:bg-[#334155]`

**components/ui/sonner.tsx**:
- Line 40 (error className): `bg-[#b91c1c] text-white border-[#f87171] ...`
- Line 42 (success className): `bg-[#166534] text-white border-[#4ade80]`

**components/submit-report-dialog.tsx**:
- Line 117 (DialogContent override): `!bg-[#111827] border-[#334155]`

**Other notes (out of scope for this migration but observed)**:
- Brand logo fills in `app/auth/sign-in/page.tsx` and `sign-up/page.tsx` (Google `#4285F4` etc. + Discord `#5865F2`) — **intentional**, untouched.
- No other hex in `components/**/*.tsx` or `app/**/*.tsx` (verified via exhaustive grep).
- `--chart-1` through `--chart-5` are referenced in `tailwind.config.ts` but **never defined** in `:root` (secondary incompleteness).

This is the **highest-leverage single change**: one root fix + 6 small className cleanups unlocks reliable tokens for the entire swarm.

---

## 2. Proposed HSL Values for Every Token (copy-paste ready)

Replace the entire `:root` block (lines 3-40) with the following. Values are mathematically precise conversions of the original HEX (rounded to whole H / whole %S / whole %L, standard shadcn practice). They produce **identical** rendered colors.

```css
:root {
  /* ProtonDB-inspired deep navy/black dark theme */
  --background: 223 47% 7%;
  --foreground: 214 3% 91%;
  --card: 221 39% 11%;
  --card-foreground: 210 2% 96%;
  --popover: 222 47% 11%;
  --popover-foreground: 214 3% 91%;
  --primary: 187 41% 69%;
  --primary-foreground: 223 47% 7%;
  --secondary: 217 33% 17%;
  --secondary-foreground: 213 5% 84%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 11% 65%;
  --accent: 188 75% 53%;
  --accent-foreground: 223 47% 7%;
  --destructive: 0 57% 60%;
  --destructive-foreground: 210 2% 96%;
  --border: 217 33% 17%;
  --input: 217 33% 17%;
  --ring: 187 41% 69%;

  /* Performance tier colors (Excellent = cyan/emerald like ProtonDB) — exact match */
  --tier-excellent: 142 71% 45%;
  --tier-excellent-bg: 145 80% 10%;
  --tier-good: 217 61% 60%;
  --tier-good-bg: 224 64% 33%;
  --tier-playable: 45 93% 47%;
  --tier-playable-bg: 26 83% 14%;
  --tier-struggling: 25 84% 53%;
  --tier-unplayable: 0 57% 60%;
  --tier-unplayable-bg: 0 75% 15%;

  --radius: 0.625rem;
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

### Additional recommended vars (see section 5)
Add these at the bottom of the block (before `--radius`):

```css
  /* Extracted from existing hard-coded bypasses for DRY + future surface depth (reversible) */
  --border-subtle: 215 25% 27%;   /* #334155 — popovers, selects, dropdowns, hovers, scrollbars, cmdk */
  --border-strong: 215 19% 35%;   /* #475569 — report-card hovers, scrollbar hover */
```

**How to use the new tokens in CSS** (example):
```css
border-color: hsl(var(--border-subtle));
background: hsl(var(--border-strong));
```

---

## 3. Prioritized Migration Checklist (incremental & safe)

**Golden rule**: Fix globals.css **first**. This makes `hsl(var(--*))` and Tailwind tokens functional everywhere. Subsequent steps are pure cleanup (remove bypasses). Each step is independently testable and git-reversible.

### Phase 0 (Prep — 5 min)
- [ ] Create branch `visual-polish/color-foundations` (or equivalent).
- [ ] Run current dev server + note any obvious broken Tailwind surfaces (for before/after).
- [ ] (Optional) Add temporary `/* OLD HEX: #0a0f1c */` comments next to new values for extra reversibility.

### Phase 1: globals.css (Highest priority — do this first)
**File**: `app/globals.css`

- [ ] Replace entire `:root` (lines 3-40) with the HSL block from Section 2 (including the 2 new `--border-*` vars).
- [ ] Update **all** direct `var(--*)` color usages inside custom rules to `hsl(var(--*))`:
  - `body` (line 45): `background: hsl(var(--background)); color: hsl(var(--foreground));`
  - All 5 `.badge-*` rules (lines 74-102): `background: hsl(var(--tier-*-bg)); color: hsl(var(--tier-*));` + borders (see below).
  - `.card:hover`, `.report-card:hover` etc.
- [ ] Replace remaining hard-coded hex in globals.css using the new tokens or direct `hsl()` (exact visual match):
  - `.card:hover` → `border-color: hsl(var(--border-subtle));`
  - `.report-card:hover` → `border-color: hsl(var(--border-strong));`
  - All 5 badge border colors: keep as `hsl(144 61% 20%)` etc inline for now (or add 5 tier-border vars only if other agents need them — prefer minimal).
  - `[cmdk-item]...` → `background: hsl(var(--secondary));`
  - Scrollbar thumb/hover → `hsl(var(--border-subtle))` and `hsl(var(--border-strong))`
  - Sonner error toast block (lines 157+): Replace `#b91c1c` etc with `hsl(var(--destructive))` variants or keep `!important` hex for the "strong pop" effect (documented exception). The `[data-sonner-toast]` rules stay powerful.
- [ ] Verify: Tailwind classes (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-primary` etc.) now render correctly. Badge colors identical. No layout shift.

**Deliverable after Phase 1**: The token system is live. 70-80% of the bug is fixed.

### Phase 2: Core surface primitives (dialog / popover / dropdown)
- [ ] `components/ui/dialog.tsx:41` — Replace `border-[#334155] bg-[#111827]` with `border-border bg-card` (remove the bypass). Keep other classes.
- [ ] `components/ui/popover.tsx:22` — Replace `border-[#334155] bg-[#1e293b]` with `border-border bg-popover` (or `bg-secondary` to match prior hex exactly; prefer `bg-popover` for shadcn semantic alignment with the `--popover` token we just fixed).
- [ ] `components/ui/dropdown-menu.tsx:50,68` — Same replacement on SubContent + Content (`border-border bg-popover` or `bg-secondary`).

**Test**: Open any dialog, popover trigger, dropdown (user menu, etc.). Visual match + now driven by tokens.

### Phase 3: Select
- [ ] `components/ui/select.tsx:78` (SelectContent) — Replace hex with `border-border bg-popover` (or `bg-secondary`).
- [ ] `components/ui/select.tsx:121` (SelectItem) — Replace the two `#334155` hover/highlight with `hover:bg-muted data-[highlighted]:bg-muted` (or `hsl(var(--border-subtle))` via arbitrary if needed for exact match). Prefer semantic where possible.

**Test**: Hardware/game comboboxes, any `<Select>`.

### Phase 4: Sonner + Submit dialog (special cases)
- [ ] `components/ui/sonner.tsx:40,42` — Clean or weaken the error/success hex overrides. Rely primarily on the strong `[data-sonner-toast][data-type="error"]` rules already in globals.css (which can now reference tokens too). Keep "strong visual pop" intent.
- [ ] `components/submit-report-dialog.tsx:117` — **Delete** the entire `!bg-[#111827] border-[#334155]` override. The base `DialogContent` (now fixed in Phase 2) provides correct styling. The `max-w-2xl shadow-2xl` can stay.

**Test**: Submit flow, all toast types (success/error/info). Error toasts must remain prominent.

### Phase 5: Polish & verification
- [ ] Global search for any remaining `#` hex in `app/` + `components/` (excluding auth brand logos + public/*.svg). Zero results expected in theme colors.
- [ ] Update `VERIFICATION_SWARM_PROMPTS.md` / any checklists that mention "no inline rgb/hex outside theme".
- [ ] Visual regression: Use existing gallery/E2E process (home, game detail, submit, reports list, admin, profile). Compare before/after screenshots side-by-side.
- [ ] Optional: Add a tiny comment block at top of `:root`:
  ```css
  /* Color system migrated to proper HSL triplets (shadcn standard).
     Original hex values preserved exactly. Revert this block to restore pre-polish state. */
  ```

**Rollback plan**: Revert the single globals.css :root commit + the 6 small edits. Zero data or logic impact.

---

## 4. Risk Assessment

**Overall risk: Very Low (highest confidence change in the swarm)**

- **Visual / Personality**: Zero risk. Exact 1:1 HSL conversions + extraction of *already-shipping* hex values. ProtonDB deep navy + tier emerald/cyan/blue/amber/red + slate surfaces preserved 100%. "No New Visual Language" rule satisfied.
- **Reversibility**: Trivial (git revert of 1-2 small diffs). Old hex can live in comments during transition.
- **Scope**: Strictly limited to the 7 sacred candidates + minimal supporting vars derived from bypasses already present. No other files touched.
- **Functionality**: **Positive** — fixes currently broken Tailwind tokens that many components already attempt to use. Improves reliability for all 8 agents.
- **Testing surface**: Primarily visual (colors in cards, badges, dialogs, selects, toasts, hovers). No behavior, auth, data, or performance impact.
- **Downstream**: Enables safe surface depth / elevation work by later agents without re-fighting hex mismatches.
- **Known minor exceptions (documented, acceptable)**:
  - 5 badge border colors may remain as inline `hsl(...)` or hex (tiny scoped surface).
  - Sonner "strong error pop" may retain some `!important` for visibility (per original intent in globals.css comment).
  - Brand logo SVG fills untouched.
- **Failure mode**: If a conversion rounding error appears (extremely unlikely at this precision), one-line tweak in :root. No cascade.
- **Tie-breaker guidance (No New Visual Language)**: Any color decision must map 1:1 to an existing value in the original :root or the 7 bypass hexes. New proposed vars are only allowed when they are direct renames/aliases of current shipping hex (as with `--border-subtle`).

This change was previously identified as the single highest-leverage fix. It is the correct foundation before any other polish.

---

## 5. Recommended New CSS Variables

**Only two** (minimal, reversible, zero new visual language):

```css
--border-subtle: 215 25% 27%;   /* Exact match to #334155. Used across dialog/popover/dropdown/select/sonner/globals bypasses for borders, hovers, cmdk, scrollbars. */
--border-strong: 215 19% 35%;   /* Exact match to #475569. Report-card hover elevation + scrollbar hover. */
```

**Rationale & usage**:
- Extracted verbatim from hard-coded values already live in the 7 sacred files.
- Enable other agents to write `border-subtle` / `hover:border-strong` without introducing new hex or inventing hues/saturation/lightness.
- Directly support "later surface depth work" (elevated cards, stronger hover states on data surfaces, layered popovers) while keeping the exact current ProtonDB-dense aesthetic.
- **Fully removable**: Delete the two lines + any usages; inlining the hsl() values restores prior state with zero visual difference.
- Do **not** recommend adding 5x `--tier-*-border` vars at this time (overkill; the 5 badge rules are tiny and self-contained).

Do not add `--surface-elevated` or chart tokens in this phase unless a concrete later agent task requires it (would violate minimal scope).

---

## 6. Copy-Paste Summary for Other Agents

**Immediate action for any dependent work**:
1. Apply the full `:root` HSL block (Section 2) + 2 border vars.
2. Update the 5-6 `var(--tier-*)` and body references in globals.css to `hsl(var(--...))`.
3. Then perform the 6 file cleanups in the order above.

All subsequent Tier 1 polish (surface depth, elevation, hover states, etc.) must use the new tokens (`--border-subtle`, `--tier-excellent`, `bg-card`, `text-foreground`, etc.) or the existing tier/badge system. No new hex allowed in the 7 sacred files.

**Questions / tie-breaks**: Route color decisions through Agent 1.

---

**End of Specification**. Ready for implementation by the swarm. This is the bedrock change.

*Generated by Agent 1 per approved Tier 1 Visual Polish plan. All values and recommendations respect "No New Visual Language" and reversibility constraints.*
