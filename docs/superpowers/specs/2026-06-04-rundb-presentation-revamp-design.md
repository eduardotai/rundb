# RunDB Presentation Revamp — Design Spec

**Date:** 2026-06-04  
**Approach:** 1 — "Repo Shine + Embedded Clarity" (selected by user)  
**Status:** Design approved by user ("yeah, you can go") after section-by-section presentation. Ready for spec commit + self-review + user review gate + writing-plans.

---

## Goal (One Sentence)

Transform the RunDB repository presentation so that it is visually clean (professional root view, scannable high-signal README) and makes it immediately obvious to any visitor — end user or potential contributor — what the app is and exactly how it works (the closed value loop of rig → real reports → predictions/similarity → community contribution, plus the dual-mode demo-vs-real reality), while staying 100% faithful to the existing architecture, invariants, and premium UI character.

---

## 1. Scope, Principles & Non-Goals

**Must deliver:**
- Root directory visually clean (historical swarm artifacts archived so `ls` and GitHub root look crisp).
- README.md completely refreshed: short, value-first, with clear narrative + diagrams that teach the loop and dual-mode without requiring readers to open source files.
- One small, high-quality, reusable educational UI component that teaches the value loop at the points users first interact (home + compatibility + game detail), using only existing design tokens, primitives, and icon set.
- Light, targeted copy and empty-state improvements that reinforce understanding without changing densities or flows.
- All explanatory content adapted directly from the authoritative `context/project-overview.md` (Core Value Loop + Architecture Pillars) and existing README voice.

**Non-negotiable boundaries (Approach 1 scope):**
- Zero changes to core logic: `lib/data.ts`, `lib/mock-data.ts` pure functions, hardware catalog, normalization, detection, ingestion pipeline, Server Actions, RLS, auth, or moderation.
- ReportCard, PerformanceBadge, GameCard, SubmitReportDialog, HardwareCombobox/DetectButton etc. remain untouched in behavior and visual density.
- No new routes or pages.
- No theme, globals.css, or Tailwind config changes.
- No new dependencies.
- No heavy onboarding flows, persistent banners, modals, or tours.
- Focus surfaces: `/` (home), `/compatibility` (embedded + full page), `/games/[slug]`. Light touch only on empty states and one provenance note.
- Historical `plans/` directory left untouched (valuable in subdir).
- No emojis in new documentation (maintains existing tone).
- The excellent `context/` "bible" remains the single source of truth for deep technical understanding; the new README funnels readers to it.

**Success criteria:**
- GitHub repo root + README feels premium, clean, and instantly educational.
- Running the app (both demo and real modes) makes the value loop and "your reports power predictions for others" obvious within the first 30–60 seconds of interaction.
- `npm run lint && npm run build` remain clean.
- No regressions in existing user flows or visual polish.

---

## 2. Root Visual Cleanup (Archive Plan)

**Files to archive (exact):**
- EXECUTION_CLOSING_REPORT.md
- FINAL_AGGREGATE_VERIFICATION_REPORT.md
- PHASE5_MONITORING_SETUP.md
- PHASE5_PRODUCTION_READINESS_CHECKLIST.md
- PHASE5_ROLLBACK_PLAN.md
- VERIFICATION_SWARM_PROMPTS.md

**Destination:** `docs/archive/historical-phase-5-and-verification/`

**New file to create:** `docs/archive/historical-phase-5-and-verification/README.md` (content below).

**Git action:** `mkdir -p ...`, create the index, then `git mv` the six files into the directory.

**New archive index content (exact):**

```markdown
# Historical Phase 5 & Verification Records

These are preserved artifacts from the multi-agent production-readiness and verification swarms that brought real Supabase data, hardware catalog (Phase 6+), ingestion pipeline, React Query adapters, and defensive dual-mode to production quality.

They document rigorous checks, e2e real-data assertions, rollback plans, and swarm prompts. They are **not** required reading for day-to-day work.

**For current understanding of the project and how to contribute:**
- Start with the main [README](../..) (or root README.md)
- Then the living context bible in `context/` (especially `project-overview.md`, `lib-data-and-types.md`, `components.md`)
- Plans for active work live in `plans/`

These files are kept for historical transparency and audit.
```

**Targeted edit to active documentation (for accuracy):**

In `context/project-overview.md` (around the previous root MDs reference):

**Before:**  
"See root MDs (PHASE5_*, FINAL_AGGREGATE_*, VERIFICATION_SWARM_PROMPTS.md, plans/*.md) for detailed decisions and verification."

**After:**  
"See `docs/archive/historical-phase-5-and-verification/` (preserved swarm artifacts) and `plans/` for detailed historical decisions and verification."

(The refreshed README will contain only a brief "History & Maturity" pointer to the archive instead of listing the files at root.)

All other internal references inside the archived files themselves are left as-is.

---

## 3. README.md Revamp

**Overall strategy:** Complete top-to-bottom rewrite. Shorter in raw length for many sections, dramatically higher signal and scannability. Heavy use of markdown structure, two mermaid diagrams (GitHub renders them), clear visual hierarchy, and direct lifts/adaptations of the "Core Value Loop" and dual-mode pillars from `context/project-overview.md`.

**Proposed top-level structure:**

1. Title + one-sentence value prop (keep "ProtonDB for actual PCs" spirit).
2. "Try it instantly (zero config)" — prominent, copy-paste friendly.
3. "Run with real community data (Supabase)" — clear  steps, links to `.env.example` and context files. Side-by-side feel with the demo path.
4. "How the magic works — the value loop" (core educational section + mermaid + prose).
5. "What you'll experience" (tight features).
6. "Key concepts (30 seconds)" (dual-mode, ReportCard, hardware catalog, etc.).
7. "For developers & contributors" (funnels hard to `context/` bible + `lib/data.ts` as the adapter heart).
8. "Tech, credits & history" (condensed; history points to archive).

**Critical new content — Value Loop section (exact mermaid + surrounding text to be used):**

```markdown
## How the magic works — the value loop

RunDB is a closed loop: your rig + real reports from similar hardware produce better predictions for you, and your reports help everyone else.

```mermaid
flowchart TD
    A[1. Save Your Rig<br/>CPU / GPU / RAM / Resolution<br/>(+ optional hardware detection)] --> B[2. Browse or Check Compatibility<br/>See real tier distributions, avg FPS by resolution, and community stats]
    B --> C[3. Read ReportCards<br/>Exact hardware + settings + FPS (avg + 1% low)<br/>+ "similar to your rig" highlights]
    C --> D[4. Submit your own report<br/>Fast validated form, under a minute]
    D --> E[Helps the whole community<br/>Updates stats instantly (demo) or after moderation (real)]
    E --> A
```

The more high-quality reports exist, the smarter the similarity engine and predictions become for everyone.
```

**Second diagram (Dual Mode) — placed in "Key concepts" or a dedicated "Demo vs Real" subsection:**

```mermaid
flowchart LR
    subgraph Demo["Demo Mode (default, zero-config)"]
        direction TB
        M[lib/mock-data.ts + localStorage<br/>(rundb_* keys)]
    end
    subgraph Real["Real Mode (NEXT_PUBLIC_USE_REAL_DATA=true)"]
        direction TB
        S[(Supabase Postgres + RLS)]
        IC[Ingest scripts + live hardware catalog]
    end
    UI[All UI & components] -->|import ONLY from| Adapter[lib/data.ts universal adapter]
    Adapter -->|USE_REAL && configured ?| Real
    Adapter -->|else or any error| Demo
    Real -.->|silent graceful fallback| Demo
```

Full quickstart blocks, key concepts bullets, and contributor guidance will be written during implementation using the structure above + current README strengths.

The long Phase 1/ingest script details, old schema sketch, and exhaustive "Extending the Mock Data" lists will be heavily condensed or removed (they live better in `context/` and script file headers).

A short "History & Maturity" paragraph at the bottom will point to the new archive for the old swarm docs.

---

## 4. In-App Clarity Additions — ValueLoopExplainer Component

**New file:** `components/value-loop-explainer.tsx`

**Purpose:** A single, elegant, reusable presentational component that makes the value loop obvious without adding noise or changing any existing interaction model.

**Props:**
```ts
export interface ValueLoopExplainerProps {
  variant?: 'prominent' | 'compact';
}
```

**Rendering & content (exact 4 steps — adapted verbatim from context/ Core Value Loop):**

1. **Save your rig once** — Enter (or auto-detect via browser scan or paste) your CPU, GPU, RAM, and preferred resolution. Rich fields (driver, kernel, distro) from detection improve similarity accuracy.

2. **See real predictions & stats** — Browse games or open the compatibility checker. Instantly view tier distributions, average FPS by resolution, and reports from players with similar hardware.

3. **Read the community** — Every ReportCard is intentionally dense yet scannable in seconds: hardware line, resolution + preset + FPS (avg + 1% low), colored performance tier badge, optional tweaks/notes/driver details, and a "similar to your rig" highlight when you have a rig saved.

4. **Contribute back** — Submit your own measured results (validated form). In demo mode changes appear everywhere immediately. In real mode the report enters moderation and then powers the database for everyone.

**Visual treatment:**
- Clean grid: 1-col mobile, 2-col md, 4-col lg.
- Each step: lucide icon (from existing set: Cpu, BarChart3, Users/FileText, Plus/ArrowRight), bold step title, 1–2 short sentences.
- Uses `border-border`, `bg-card`, `text-primary`, `text-muted-foreground`, rounded-2xl, consistent padding/spacing with existing cards.
- No new CSS. Subtle visual connection (or just clean numbered steps) to feel like a loop.
- `prominent` variant has a light heading and more breathing room (for home replacement of trust bar).
- `compact` variant is tighter, suitable below the compatibility card header.

**Exact insertion points & surrounding changes:**

**Home (`app/page.tsx`):**
- Remove the entire `{/* Trust bar */}` div (lines ~297-303 in current).
- After the trending games block (after the loading/privacy notices), insert:
  ```tsx
  <div className="mb-12">
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="text-2xl font-semibold tracking-tight">How RunDB works</h2>
    </div>
    <ValueLoopExplainer variant="prominent" />
  </div>
  ```
- Also lightly enhance the two existing "no games / no trending" dashed boxes (see Section 5).

**Compatibility checker:**
- In `components/compatibility-checker.tsx`, after the existing `<CardHeader>` description paragraph (the one that already says "Save your hardware once..."), optionally render `<ValueLoopExplainer variant="compact" />` inside the CardContent (or right after the header) when `!embedded`. The prominent version on home already covers the embedded case on the landing page.

**Game detail (`app/games/[slug]/page.tsx`):**
- In the right column (reports side), immediately before or as part of the "Filter reports:" header area (around the filters div), add this one-line provenance note (no component instance):
  ```tsx
  <div className="text-xs text-muted-foreground mb-2">
    These reports from real players power the community stats, tier distributions, and similarity highlights on the left.
  </div>
  ```

**Empty state polish (home only, for teaching value):**
- "No games in the database yet" block: keep existing seed hint when `USE_REAL`; append " — the database grows through community reports and the ingest pipeline."
- "No trending games yet" block: change the body text to "Community reports will rank titles here. Save a rig, browse games, or submit a few reports to see activity."

The component is deliberately small and self-contained so it can be iterated on or removed later with minimal impact.

---

## 5. Other Hygiene & Small Text Updates

- `package.json`: `"name": "grokbuild"` → `"name": "rundb"` (description can stay or be lightly refreshed; this is the only occurrence that matters for repo identity).
- `app/layout.tsx` footer: Refresh for consistency with new language while keeping the important "hybrid" clarity:
  ```tsx
  <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
    Real community-driven PC performance data. Hybrid demo + real backend (flag-controlled).
    <span className="mx-2">·</span>
    Inspired by ProtonDB, PCPartPicker, and HowLongToBeat.
  </footer>
  ```
- No other broad copy sweeps. The targeted provenance sentence and empty-state tweaks above are the only in-app text changes outside the new explainer.

A tiny root `CONTRIBUTING.md` (pointing to `context/` as the bible) is **out of scope** for strict Approach 1 unless it feels like a zero-cost win during implementation.

---

## 6. Files Touched / Created Summary (for Implementation Planning)

**New files (implementation will create):**
- `docs/archive/historical-phase-5-and-verification/README.md`
- `components/value-loop-explainer.tsx`

**Files to move (git mv):**
- The 6 historical root MDs listed in Section 2.

**Files to modify:**
- `context/project-overview.md` (1 sentence)
- `README.md` (full rewrite)
- `package.json` (name only)
- `app/layout.tsx` (footer)
- `app/page.tsx` (trust bar removal + explainer insertion + 2 small empty state text tweaks)
- `components/compatibility-checker.tsx` (light insertion of compact explainer)
- `app/games/[slug]/page.tsx` (one small provenance note + import if needed for types)

**No other files touched.**

---

## 7. Verification & Rollout Steps

After implementation:
1. `npm run lint`
2. `npm run build` (must succeed cleanly)
3. `npm run dev`
4. Manual smoke:
   - Load home in demo mode: hero, embedded checker, trending, new "How RunDB works" explainer visible and attractive.
   - Save a rig → see predictions and similarity pills.
   - Go to a game detail → see the small provenance note above filters + ReportCards.
   - Go to full `/compatibility` → see compact explainer if added.
   - Toggle `NEXT_PUBLIC_USE_REAL_DATA` (if Supabase configured) and confirm graceful behavior + same explanatory content.
5. README renders with working mermaid diagrams on GitHub (or GitHub preview).
6. Root directory now shows only active files + `docs/`, `context/`, `plans/`, etc. (no more swarm artifacts at root).
7. No visual or interaction regressions in ReportCards, submit flow, or hardware combobox/detection.

---

## Self-Review (performed after writing this spec)

- [x] No "TBD", "TODO", or placeholder language in requirements.
- [x] All scope decisions are explicit and consistent with Approach 1 presentation.
- [x] Mermaid diagrams are concrete and will be copy-paste ready.
- [x] Component spec includes exact props, content, and insertion points with line guidance.
- [x] Non-goals are listed and match the "do no harm to existing quality" spirit of the project.
- [x] Verification steps are actionable and cover both repo view and running app.
- [x] All changes are additive or archival — no risk to dual-mode contract, data adapter, or ReportCard.
- [x] References back to `context/` files are preserved and strengthened.
- Internal consistency: README educational content matches the explainer content and the source `context/project-overview.md` Core Value Loop.

Any issues found during self-review were fixed inline before this version.

---

**Next per process:** This spec will be committed. User will be asked to review the committed file. Only after explicit user approval of the written spec will we invoke the writing-plans skill and begin implementation.

This design delivers a true "total revamp" of the presentation layer while being surgically respectful of everything that already makes RunDB special.
