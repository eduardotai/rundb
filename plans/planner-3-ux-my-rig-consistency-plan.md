# Hardware Validation Planner Agent #3: UX, Client Warnings, My Rig Consistency & User Education Plan

**Focus:** User-Facing Experience, Non-Punitive Client Warnings, My Rig Consistency Layer, Report Card Indicators, Global Education & Accessibility  
**Date:** 2026-05-26  
**Context:** Builds directly on the two completed plans:
- `plans/planner-1-hardware-catalog-plan.md` (static `lib/hardware-performance-catalog.ts`, `HardwarePerfEntry`, `GPU_CATALOG`/`CPU_CATALOG`, `perfIndex`, `validateHardwarePerformance`, `HardwareValidationResult`, `estimateExpectedFps`, `getCanonicalHardware`, `CATALOG_VERSION`, wide tolerance bands, `severity: 'ok' | 'warn' | 'block'`, `expectedRange`, `deviationRatio`, `canonicalGpu`/`canonicalCpu`, `reason`, DB `hardware_performance` path, seeding from PassMark/TPU, admin catalog viewer).
- `plans/planner-2-validation-submit-flow-plan.md` (pure function wiring into `submitReportAction` after dup checks + client pre-check in `submit-report-dialog.tsx`, `HardwareValidationResult` shape, non-accusatory reason templates, "Submit anyway" for warn + forceSubmit, block hard reject via server Error, 1% low rules, unknown hardware graceful degradation, client banner sketch using amber tokens).

This plan delivers the **complete delightful, trust-building, educational UX layer** so validation feels like a helpful community tool (like ProtonDB notes) rather than a police state. All features maintain **identical behavior for authenticated users (incl. anonymous Supabase anon users via user_rigs/profiles), guests (localStorage only via 'rundb_my_rig' + 'rundb_user_reports')**, real/mock via `NEXT_PUBLIC_USE_REAL_DATA`, and reuse the exact data adapter (`loadMyRigAsync`/`saveMyRigAsync`/`useMyRig`, `addUserReport`).

**Core Philosophy (enforced everywhere):**
- Never accusatory: "may reflect", "wide tolerance applied for OC / DLSS+FG / capture / driver / laptop power limits / patches / RAM timings", "Please double-check your FPS counter or settings".
- Educational first, actionable second.
- "Submit anyway" or "Edit" always available for `warn` (per Planner 2).
- Positive reinforcement for good data ("Your reports look rock-solid consistent with this rig!").
- Transparent about the catalog (sourcing, limits, variance factors from Planner 1 §10).
- Mobile-first, accessible (existing focus-visible, aria-label patterns, sr-only, 44px+ targets, color + icon + text).

---

## 1. Research Summary from Codebase Inspection (Mandatory Inputs + Current State)

Inspected (via tools): both planner files + `components/profile-rig-editor.tsx`, `components/compatibility-checker.tsx`, `components/my-rig-indicator.tsx`, `app/profile/page.tsx`, `app/my-reports/page.tsx`, `app/games/[slug]/page.tsx` (full myRig load + listener + teaser + ReportCard pass-through + SubmitReportDialog + bottom CompatibilityChecker), `components/report-card.tsx`, `components/performance-badge.tsx`, `components/submit-report-dialog.tsx`, `lib/toast.ts`, `components/ui/sonner.tsx`, `app/layout.tsx`, `app/submit/page.tsx`, `lib/types.ts` (UserPC, Report with status/moderatorNotes/userId, SubmitReportInput), `lib/data.ts` (full My Rig async paths + useMyRig hook + predictForUserRigAsync), `lib/mock-data.ts` (LS_USER_REPORTS, LS_MY_RIG, addUserReport, loadMyRig), `app/actions/reports.ts` (submitReportAction order: auth → game → tier → rate/dup → insert), `app/globals.css` (tier badges, dark theme vars, amber/emerald usage patterns), multiple ui/ primitives + greps across codebase.

**Existing Design System (reuse 100% where possible):**
- **Cards**: `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent` (p-6 patterns). Used in rig editors, checker predictions, game stats. New panels = composed Cards.
- **Badges**: `Badge` (cva: default/secondary/destructive/outline) + custom `.badge-excellent` etc in globals.css (bg + color + border for tiers). `PerformanceBadge` (sizes sm/md/lg, reuses tier CSS). New `HardwareMatchBadge` and `PlausibilityIndicator` follow exact same pattern (new CSS classes or Tailwind + existing tokens).
- **Dialogs**: Full Radix `Dialog`/`DialogContent` (dark custom `!bg-[#111827] border-[#334155]` in submit), `DialogHeader`/`Title`/`Description`. Submit overrides max-w-2xl. Warnings live inline inside form (not nested Dialog).
- **Toasts**: Sonner via `<Toaster position="top-center" richColors closeButton />` (layout). `lib/toast.ts`: `showUserError` (red, 5200ms, closeButton), `showUserSuccess(msg, description?)`. Direct `toast.success(..., {description})` / `toast.info` / `toast.error` used in checker + heavy admin usage. Prefer lib wrappers for user errors/success; direct sonner for rich descriptions/actions in rig health flows. Icons via lucide in sonner.tsx (success=CircleCheck, warning=TriangleAlert, etc.).
- **Expand/Accordion pattern**: ReportCard uses local `useState` + `ChevronDown`/`ChevronUp` (lucide) + conditional `bg-muted/40 p-3` content. Perfect reusable model for "Why this might happen" (no shadcn Accordion present; avoid new deps).
- **Colors (ProtonDB dark theme)**: amber-400/500/950/30 for warnings (see admin amber box: `border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200`; game "Minimum" labels). emerald-400/500/5/30 for positive rig active / similarity matches ("X% match to your rig" in ReportCard). Use these + tier vars exactly.
- **Buttons**: Primary = `bg-white text-black font-medium hover:bg-white/90`. Ghost/outline variants for secondary actions ("Edit values", "Submit anyway").
- **Forms**: RHF + Zod in submit (sanitized). Inputs/Labels/Select/Textarea/ existing error `<p className="mt-1 text-xs text-destructive">`.
- **Responsive/Mobile**: Heavy `md:grid-cols-2`, `md:flex-row`, `hidden md:flex` (MyRigIndicator, header nav). Report cards stack nicely. New surfaces must flex-col on mobile, full-width buttons, touch-friendly.
- **A11y**: Sparse but present — `aria-label` (clear rig), `sr-only` (dialog close), `aria-describedby`/`aria-invalid` (forms), `focus-visible:ring` (tabs/ui). ReportCard keyboard via click handlers. New UI must add labels, roles, focus management (especially dialog banners + accordions).
- **My Rig architecture (critical for consistency layer)**: Dual persistence (user_rigs primary for checker + profiles.main_* mirror for profile editor). `loadMyRigAsync`/`saveMyRigAsync`/`clearMyRigAsync` (data.ts) + auth listeners everywhere (game page, checker, indicator, profile). `useMyRig()` RQ hook exists. Guests: only LS 'rundb_my_rig'. User reports for anon: LS 'rundb_user_reports' via mock `loadUserReports`/`addUserReport`. Similarity: `calculateSimilarity` (used in ReportCard).
- **Current gaps (addressed here)**: No rig health on save, no hardware match on My Reports (placeholder page), no plausibility on ReportCard, no submit pre-warn UI (Planner 2 sketch only), no consistency scan, no education surface, no "rig vs my reports" panel. Submit dialog is clean form (insertion point after driver row before actions is perfect).

No catalog/validation code exists yet — this UX plan assumes pure functions from Planner 1 are importable on client (`validateHardwarePerformance`, plus new lightweight `getRigPerformanceLabel(rig)` or reuse `estimateExpectedFps` averaged).

---

## 2. Submit Dialog Rich Warning UI (Primary Hot Path — Builds Exactly on Planner 2 §4.2)

**Goal**: When client pre-validation (or server block caught) returns `severity === 'warn'` (or block), surface rich, non-accusatory banner **inside the existing Dialog** before the action buttons. Never punishes; educates + offers clear next steps. "Submit anyway" for warn only (sets `forceSubmit` and re-submits, producing `flagged` + `moderatorNotes` per Planner 2).

**Exact Insertion Point** (in `components/submit-report-dialog.tsx`):
- After the driverVersion grid (current ~line 233), before the `flex justify-end gap-2 pt-2` buttons row.
- Also: augment footer p (line ~248) with "Hardware plausibility checked with curated catalog v{CATALOG_VERSION}." (subtle, muted).
- Reset `validationResult` + `forceSubmit` on `onOpenChange(false)`, form.reset, and dialog close paths (add to existing reset logic).

**State Additions** (per Planner 2 sketch + enhancements):
```ts
const [validationResult, setValidationResult] = useState<HardwareValidationResult | null>(null);
const [forceSubmit, setForceSubmit] = useState(false);
const resetValidation = () => { setValidationResult(null); setForceSubmit(false); };
```
Import: `validateHardwarePerformance` from `@/lib/hardware-performance-catalog` (or re-export via `@/lib/data`), `HardwareValidationResult` from `@/lib/types`.

**onSubmit Augmentation** (exact per Planner 2 + rich UI trigger):
- Run validation early.
- `if (block)`: `showUserError(...)`; return.
- `if (warn && !forceSubmit)`: setValidationResult(v); setIsSubmitting(false); return; (shows banner, does not call addUserReport yet).
- `handleSubmitAnyway = () => { setForceSubmit(true); form.handleSubmit(onSubmit)(); }`

**Wireframe / Visual Description (amber non-accusatory banner)**:
```
┌─────────────────────────────────────────────────────────────┐
│  [TriangleAlert icon amber-400] Hardware plausibility warning│
│                                                             │
│  Reported avg FPS (240) is 3.4× higher than expected (~71,  │
│  range 31-162) for RTX 3060 Ti + Ryzen 5 5600X at 3840x2160 │
│  Ultra in Cyberpunk 2077 (catalog 2026.05.26-v1).           │
│                                                             │
│  Expected ~71 fps (range 31–162). Wide tolerance applied.   │
│                                                             │
│  ▼ Why this might happen (tap to expand)                    │  ← educational accordion (reuse ReportCard pattern)
│    • Overclocking or undervolting + custom power limits     │
│    • DLSS/FSR/XeSS Quality + Frame Generation (often 1.8-2.5×)│
│    • Lossless Scaling / RTSS / driver overlay capture       │
│    • RAM speed/timings or storage (not modeled in MVP)      │
│    • Laptop vs desktop power/thermal limits                 │
│    • Recent game patch or driver magic (560.81+)            │
│    • 1% low measurement variance (in-game vs external)      │
│    • Hardware not yet in catalog — conservative baseline    │
│                                                             │
│  [Edit hardware / FPS values]   [Submit anyway (flagged for review)] │
└─────────────────────────────────────────────────────────────┘
```
- **Styling**: `rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-sm` (exact match to admin warning + Planner 2 sketch). `font-medium text-amber-400`, body `text-amber-200/90`, small expected text `text-[10px] text-muted-foreground`.
- **Accordion**: Local `useState(isWhyOpen)`, button with ChevronDown/Up (lucide, same as ReportCard), conditional content in `rounded bg-muted/40 p-3 text-xs space-y-1`. Bullets use existing text + lucide icons where delightful (e.g. small Zap for OC).
- **Actions**:
  - "Edit hardware / FPS values": `setValidationResult(null); /* optionally focus first input */` (user edits form live; re-validate on next submit attempt).
  - "Submit anyway...": amber outline button, calls handleSubmitAnyway. On success: `showUserSuccess('Report submitted — flagged for moderator review (hardware variance noted). Thank you!')`.
- **Block case**: Never shows banner (already prevented). Falls to existing catch → `showUserError` (full reason or truncated friendly). Server is final (Planner 2).
- **Accessibility**: `role="alert"` on banner, aria-live, keyboard focus on action buttons, labels. Mobile: stacks buttons vertically (`flex-col sm:flex-row`).
- **New small component?** Optional: extract `<ValidationWarningBanner result={v} onEdit={() => ...} onSubmitAnyway={...} />` for reuse (e.g. future checker "what-if" warnings). Props: `validation: HardwareValidationResult`, callbacks. Lives in `components/validation-warning-banner.tsx`. Start inline in dialog for MVP speed; extract in Phase 2.

**Toast patterns here**: Only for final success/error (use lib wrappers). Banner is the primary surface for warn (avoids toast overload in dialog).

---

## 3. "My Rig" Save → Rig Health Check + "Validate Past Reports" (Both Editors)

**Trigger points** (after successful persistence):
1. `components/profile-rig-editor.tsx` `handleSave` success path (after `showUserSuccess('Rig saved!')`).
2. `components/compatibility-checker.tsx` `saveRig` success (after `toast.success` or `showUserSuccess`).

**New behavior** (post-catalog):
- Import `getRigPerformanceLabel` (new pure helper in catalog per synergy with Planner 1 §7 "getRigPerfScore" + `estimateExpectedFps` averaged across representative games/res/presets; returns `{ label: 'High-Mid' | 'Flagship' | 'Low-End' | ..., perfScore: number 0-100, summary: string }` or fallbacks).
- After save: replace or augment the plain "Rig saved!" with richer success + **inline or toast + persistent card**:
  ```
  Rig saved! Your rig scores as High-Mid (perf ~68). 
  Great for 1440p High 60-100 fps in most modern titles.
  [Validate my past reports against this rig →]
  ```
- **RigHealthCard** (new small reusable component `components/rig-health-card.tsx`): 
  - Props: `rig: UserPC`, `health: RigHealthResult` (new type in types.ts).
  - Renders as `Card` (or compact div matching MyRigIndicator pill + emerald accents) with score badge (reuse PerformanceBadge styling or new .rig-health-high-mid etc via CSS or Tailwind emerald/amber), summary text, "Catalog vX" subtle.
  - Positive/neutral tone always.
- **"Validate my past reports" button** (primary action): Opens **RigConsistencyPanel** (see §7 below) pre-filtered to "my reports only" + runs retro scan client-side (or via new lightweight server helper later). Shows list of any inconsistencies (using `validateHardwarePerformance` on each of user's reports vs current rig + game context). "3 of your 12 reports may need review (possible hardware upgrade since then?)" + per-report links (to game page or future edit).

**Anonymous parity**: Same flow using local LS rig + `loadUserReports()`. "Guest mode — data stored only in this browser."

**Insertion**:
- Profile editor: After the save button row, conditionally render `<RigHealthCard ... />` (or inside the success state).
- Checker: In the save success toast description (rich) + render the health card above the predictions section or in a new "Your Rig Health" subsection.

Reuse: emerald positive styling from game-page "Your saved rig is active" teaser box.

---

## 4. My Reports Page — "Hardware Match" Column/Badge + Details

**Current state**: Placeholder (auth-only redirect + dashed empty). Will need real query for user's reports (future: Supabase `reports` where user_id = auth.uid(), or local for demo).

**New UI** (once list implemented):
- Table or grid of user's reports (reuse ReportCard compact? or new table with columns: Game | Your Hardware | Avg FPS + 1% | Performance Tier (PerformanceBadge) | **Hardware Match** | Date | Actions).
- **HardwareMatchBadge** (new `components/hardware-match-badge.tsx`, reuse PerformanceBadge + Badge primitives):
  - Variants: `consistent` (emerald bg/text + "Consistent"), `minor` (amber "Minor variance"), `review` (destructive/amber-red "Needs review").
  - Computes per-report: `validateHardwarePerformance({ ...report fields, gameId })` vs **current saved My Rig** (loadMyRigAsync). If no current rig: show "No rig saved" (link to profile/checker).
  - Click / hover: Opens lightweight modal or expands (reuse ReportCard details pattern) showing the `HardwareValidationResult` details: "Submitted 142 fps vs expected 78 (range 35-170) for this rig + game. Severity: warn. Reason: ... (catalog vX)".
- "Rig vs Reports consistency" summary banner at top (see §7).
- For anon: "Viewing your locally saved reports. Sign in to persist across devices."

**Exact insertion**: New column after Performance Tier (or replace "Your hardware" with match badge + hardware). Clicking badge or "View validation" triggers details (Dialog or inline Card).

**Mobile**: Badges stack or become icons + text below FPS. Cards instead of table on <md.

---

## 5. Public Report Cards — Subtle Plausibility Indicator (Owner/Mod Gated)

**Enhance `components/report-card.tsx`**:
- New optional prop: `showPlausibility?: boolean` (or auto-detect via `currentUserId?: string | null` + `report.userId`).
- **Only visible to**:
  - The submitter (report.userId === currentUserId, or for anon: report id in local LS_USER_REPORTS ownership heuristic).
  - Mods (future role check or always in /admin context).
- **Visual**: Subtle, non-intrusive. Bottom-right or near tier badge: small `PlausibilityIndicator` (new tiny component):
  - Green check "Plausible" (ok) or "Community consensus strong" (once data).
  - Amber "Flagged by catalog (variance)" with tooltip or click → "View details" (shows the validation reason + expectedRange if available; recompute client if needed using current catalog).
  - Once enough same-hardware reports: "87% of similar hardware reports within 15% of this FPS".
- **Styling**: `text-[10px] text-muted-foreground/60 inline-flex items-center gap-1` + tiny lucide icon. Never loud. Hover/focus shows full reason in popover (use existing Popover ui? or simple title/tooltip).
- **Public view**: Hidden for non-owners (keeps community trust; no public shaming).
- Reuse: Existing expanded details area + similarity logic.

**Insertion in ReportCard**: After similarity badge or in footer, conditional.

In game page + other lists: pass `currentUserId` (from auth) when rendering lists.

---

## 6. Global Education Surface — "How We Validate Performance Claims"

**Placement options (pick 1-2 for MVP)**:
- Small info link/icon next to submit buttons (game page, /submit page, dialog footer): "How we validate" → opens **EducationalDialog** or inline section.
- Dedicated expandable section in Profile (near My Rig) and CompatibilityChecker.
- Footer link or new `/about/validation` (light page).

**Content (transparent, delightful, references Planner 1 exactly)**:
- "We use a curated Hardware Performance Catalog (vX, seeded from public PassMark G3D/CPU Mark + TechPowerUp cross-refs — see Planner 1) to estimate plausible FPS ranges."
- Factors: GPU/CPU perfIndex (70-80% GPU weight), resolution/preset/game multipliers, RAM floor, extremely wide tolerance bands (0.43x–2.28x+) deliberately absorb real-world variance: overclocking, DLSS+Frame Gen, capture methods, laptop thermals, patches, driver magic, 1% low differences.
- "Validation is a helpful plausibility gate + moderator aid (flags go to human review with rich notes). It never replaces community moderation or your notes/tweaks field."
- "Legitimate high claims on mid-hardware are common with modern upscaling + FG — our bands are intentionally generous."
- Link to source notes in catalog file header.
- "Questions? The catalog is open for community curator contributions."

**Component**: `<HowWeValidateInfo />` (small, reusable). Uses existing Card or Popover + lucide Info icon. Or full Dialog with markdown-ish content.

**Tone**: Educational, community-positive, builds trust in the data.

---

## 7. "Rig vs Reports Consistency" Feature (The Heart of Planner 3)

**Primary surface**: New **RigConsistencyPanel** component (`components/rig-consistency-panel.tsx`).

**Trigger / Placement**:
- Prominent button "Check consistency of my reports against current My Rig" in:
  - `/my-reports` (top, below header — always visible if rig or "Save a rig first" CTA).
  - Profile page (near RigHealthCard).
  - CompatibilityChecker (new "Rig Health & Consistency" subsection).
  - Optional: next to MyRigIndicator in header (popover on click, for logged-in).
- **For guests/anon**: Fully functional with local LS rig + `loadUserReports()`.

**UI / Interaction**:
- Summary hero: "X of your Y reports look consistent with your current saved rig (RTX 4070 + 7800X3D). 3 reports may need review (possible hardware change, different PC, or capture differences since submission?)."
  - Green/amber/red big number pills.
- "Run scan" button (idempotent, fast client-side using validateHardwarePerformance on each report + current rig + game context).
- Filterable list of outliers (or all): Reuse compact ReportCard or new mini rows showing game + submitted FPS vs expected (from validation) + severity badge + "Review on game page" link.
- "Mark as reviewed" (local only for MVP; future persisted note).
- Empty/good state: Celebratory "All your reports are beautifully consistent with this rig. Great data for the community!"
- Loading skeleton while scanning (client pure fns = instant, but network reports load).
- Export note or "This helps us improve catalog factors over time."

**New type** (add to lib/types.ts): `RigConsistencyResult { consistentCount: number; total: number; outliers: Array<{report: Report, validation: HardwareValidationResult}>; ... }`

**Implementation note**: Client-only for speed/privacy (pure fns). For very large history, limit to last 50 or paginate. Recompute on rig change.

**Wireframe**:
Top summary bar (Card with emerald/amber accents) → Scan button → Grid of mini validation cards (amber for outliers) → "All good" confetti-lite if 100% consistent (subtle).

---

## 8. Toast / Feedback Patterns (Consistency with Sonner + lib/toast)

- Rig save health: `showUserSuccess('Rig saved!', {description: 'High-Mid rig (~68). Great for 1440p... [link or auto-open panel]'})` or direct sonner with action button if supported.
- Submit success after "anyway": include " (noted for review)" in message.
- Errors: Always via `showUserError` (short friendly).
- Info toasts for clear rig, etc. (existing).
- New: On consistency scan complete: subtle success/info toast "Scan complete: 9/12 consistent".
- Never spam: dedupe, use descriptions, respect existing durations.

---

## 9. Accessibility, Mobile, Responsive, Delight Details

- **A11y**: Every new interactive (banners, accordions, badges, panels) gets `aria-label`, `aria-expanded` for toggles, `role="region"`/`alert`, keyboard (Tab, Enter/Space for accordions/buttons, Escape closes dialogs). Focus trap in dialogs preserved. Color + icon + text (never color alone). High contrast (existing tokens pass). Screen reader friendly reasons.
- **Mobile**: All flex-col by default on <md. Dialog content scrollable. Touch targets ≥44px (buttons padded). My-rig-indicator already hidden md (ok; consistency panel always available in pages). Stacked report lists.
- **Motion**: Respect `prefers-reduced-motion` (Tailwind already). Subtle hovers only.
- **Delight**: Micro-animations on badge changes (existing report-card), celebratory language on perfect consistency, "Thank you for helping the community with accurate data!" on good submissions. Icons from lucide (consistent: CheckCircle, warn: AlertTriangle, info: Info).
- **Dark theme**: 100% reuse (amber/emerald on dark backgrounds work great per existing).

---

## 10. New Small Components (All Reusable, Design-System Aligned) + Exact Insertion Points

1. `components/validation-warning-banner.tsx` — For submit (and future). Props: validation, onEdit, onSubmitAnyway, className. Internal accordion.
2. `components/rig-health-card.tsx` — Score + summary + CTA button to consistency. Used post-save in editors + profile.
3. `components/hardware-match-badge.tsx` — cva or tier-like: consistent/minor/review. Clickable for details.
4. `components/plausibility-indicator.tsx` — Tiny, owner-gated. Props: report, currentUserId, validation (optional).
5. `components/rig-consistency-panel.tsx` — Full panel + summary + list. Self-contained (loads rig + reports internally via hooks).
6. `components/how-we-validate-info.tsx` — Trigger + content (Dialog or Popover + rich text).

**Other insertions**:
- Extend ReportCard props + conditional render.
- game/[slug]/page.tsx: Enhance existing emerald "Your saved rig is active" teaser with health link or consistency teaser.
- my-reports/page.tsx: Full new section + table enhancements (assume future list impl uses ReportCard or table).
- profile/page.tsx + checker: Post-save health card.
- Submit dialog + /submit page + game page submit buttons: unchanged (dialog internal).
- Footer or site-header: optional global education link.
- Admin (future): richer per-report validation notes display (already in moderatorNotes).

All new components use existing imports (Card, Badge, Button, lucide, cn, sonner if needed). No new deps. TypeScript strict.

---

## 11. Anonymous + Real/Mock Parity, Rollout, Risks

- **Anonymous**: Full feature set via LS + loadUserReports. "Local only" disclaimers where relevant.
- **Real mode**: DB reports + user_rigs/profiles + server flags (Planner 2) + client validation identical.
- **Phased (align Planner 1+2)**: MVP after catalog + submit wiring (use new components immediately in dialog + rig saves). My Reports + consistency after reports list exists. Public indicators after auth context wired.
- **Risks & Mitigations**: Education fatigue (default collapsed, positive defaults); perf on large history (limit scans, memoize); anon data volatility (clear warnings); overclaiming catalog precision (always "approximate", "wide bands").
- **Testing matrix**: Submit borderline (see amber banner + accordion + edit/anyway paths); save rig in both editors (health card + CTA); My Reports (badges + click details); ReportCard as owner (plausibility visible); guest full flow; a11y keyboard + mobile resize; consistency with/without rig.

---

## 12. Handoff Checklist for Implementation

- [ ] Read all three planner docs + this UX spec + inspect the 12+ files listed.
- [ ] Add `HardwareValidationResult` + `RigHealthResult` + consistency types to `lib/types.ts` (with Planner 1/2).
- [ ] Implement catalog helpers (Planner 1) + `getRigPerformanceLabel` / consistency helpers.
- [ ] Wire client validation + full rich banner (with accordion) in submit-report-dialog (per §2 + Planner 2).
- [ ] Add health check + RigHealthCard after saves in profile-rig-editor + compatibility-checker.
- [ ] Build HardwareMatchBadge + PlausibilityIndicator + extend ReportCard.
- [ ] Implement My Reports hardware match column + details (when list ready).
- [ ] Build RigConsistencyPanel + wire triggers across profile/my-reports/checker.
- [ ] Add global education surface + HowWeValidateInfo.
- [ ] Toasts, a11y, mobile polish, anon parity tests.
- [ ] Unit/E2E: all flows above; visual regression on banners/badges.
- [ ] Update any PHASE notes / README.

This completes the full user-facing trust layer. Validation now feels like a helpful friend that explains variance and celebrates good data — exactly as intended by the catalog and submit enforcement in Planners 1+2.

**Next step**: Implement catalog (Planner 1) + submit wiring (Planner 2) first, then layer this delightful UX on top.

— Hardware Validation Planner Agent #3 (UX, Client Warnings, My Rig Consistency & User Education Focus)