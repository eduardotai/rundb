# components Context

## Purpose
`components/` owns reusable UI and product interaction pieces for RunDB. It contains domain components, shadcn/Radix primitives, charts, profile/report tools, dashboard widgets, and form dialogs.

## Read This First
- `report-card.tsx`: the central product component; dense, scannable benchmark evidence is the heart of RunDB.
- `compatibility-checker.tsx`, `match-feed.tsx`, `my-rig-indicator.tsx`, `profile-rig-editor.tsx`: hardware-aware prediction and saved-rig surfaces.
- `submit-report-dialog.tsx`, `game-combobox.tsx`, `hardware-combobox.tsx`, `hardware-detect-button.tsx`, `paste-hardware-modal.tsx`, `detected-hardware-banner.tsx`: report submission and hardware identification flow.
- `game-card.tsx`, `game-cover-frame.tsx`, `performance-badge.tsx`, `charts/*`: catalog cards, cover handling, tiers, and performance summaries.
- `dashboard/*`, `profile/*`, `my-reports/*`, `reports/*`: feature-specific component groups.
- `ui/*`: shadcn/Radix primitives used by product components.

## Main Responsibilities
- Present user-facing performance evidence: FPS, 1% lows, hardware, settings, tiers, notes, tweaks, issues, votes, and similarity.
- Keep hardware capture explicit and reviewable: detect or paste -> show results -> user applies manually.
- Provide catalog browsing, game selection, report filtering, compatibility prediction, profile display, and editing workflows.
- Reuse shadcn/Radix primitives for dialogs, commands, popovers, forms, tabs, tables, inputs, selects, and buttons.
- Use Lucide icons for icon buttons and familiar commands.
- Keep the visual system consistent with `app/globals.css`, Tailwind tokens, tier colors, and existing spacing/radius patterns.

## Data Flow
- Components import product data helpers and hooks from `@/lib/data`.
- Form components validate through local schemas or types that match `lib/types.ts` and server action payloads.
- Submit/report/profile flows call server actions or adapter functions rather than reaching around the architecture.
- Cover display uses enriched game data or cover helpers from `lib/`; avoid rebuilding fallback chains inside components.
- Chart components receive prepared domain data and should keep calculations simple or delegate to `lib/chart-helpers.ts`.

## AI Rules
- Do not import raw Supabase clients, service clients, or mock data into UI components.
- Preserve ReportCard scannability: hardware line, resolution/settings, FPS, tier, similarity, and expandable evidence should remain quick to parse.
- Use `HardwareCombobox` for CPU/GPU fields unless there is a specific reason not to.
- Hardware detection is never auto-apply; users must review and choose what gets saved or submitted.
- Use existing `components/ui/*` primitives before adding new UI abstractions.
- Do not hardcode tier colors in components; use global tier classes or semantic tokens.
- Keep client components explicit with `"use client"` only where interactivity, hooks, or browser APIs require it.
- Avoid putting domain logic in components when it belongs in `lib/`.

## Common Changes
- Adding a new form field: update the form component, validation schema, `lib/types.ts`, server action payload, data mapper, Supabase schema/RPC if persisted, and tests.
- Adding a new visual status or tier: update global CSS tokens/classes, `PerformanceBadge`, `ReportCard`, charts, and tests for helpers.
- Extending hardware UX: update combobox/detection/paste components, normalization helpers in `lib/`, saved-rig flows, and submit prefill behavior.
- Adding a feature component: place it near related components, compose existing primitives, and expose only props needed by the owning page.
- Editing dashboard/profile/my-reports components: check their route files in `app/` and the adapter functions they depend on.

## Verification
- Run `npm run lint` after TSX edits.
- Run `npm run test` when helper logic, data transformations, charts, or validation behavior changes.
- Run `npm run build` for broad component changes that may affect server/client boundaries.
- Use `npm run dev` and inspect affected pages for layout, responsive behavior, and console errors.

## Related Context
- `../app/context.md`
- `../lib/context.md`
- `../supabase/context.md`
- `../tests/context.md`
