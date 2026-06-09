# app Context

## Purpose
`app/` owns the Next.js App Router runtime for RunDB: pages, layouts, route handlers, server actions, auth callbacks, global providers, and global styles.

## Read This First
- `layout.tsx`: root shell, metadata, fonts, theme, and shared header wiring.
- `providers.tsx`: client providers, especially TanStack React Query defaults.
- `page.tsx`, `games/page.tsx`, `games/[slug]/page.tsx`, `compatibility/page.tsx`, `reports/page.tsx`, `submit/page.tsx`: main public product surfaces.
- `actions/reports.ts`, `actions/ingest-queue.ts`, `actions/hardware-catalog.ts`, `actions/resolver.ts`: server actions for protected writes and operational flows.
- `auth/**` and `api/**/route.ts`: auth callbacks, Steam linking, and small route-handler APIs.
- `admin/**` and `dashboard/**`: privileged and internal operational surfaces.
- `globals.css`: global theme tokens, tier colors, report card polish, and app-wide utility classes.

## Main Responsibilities
- Render the public RunDB experience: home, game catalog, game detail reports, compatibility checker, reports list, report submission, profile, and my reports.
- Keep pages thin by coordinating data hooks/actions and composing domain components from `components/`.
- Route all normal product data access through `@/lib/data` or server actions, not raw Supabase calls.
- Handle protected writes through Server Actions and Supabase RPCs where RLS or service-role access matters.
- Maintain auth flows for email, OAuth, password reset, callbacks, Steam linking, and confirmed/error states.
- Gate admin surfaces through server-side role checks and database policies.

## Data Flow
- Client pages use React Query hooks from `@/lib/data` such as `useGames`, `useGame`, `useReportsForGame`, `usePrediction`, and `useMyRig`.
- Server components can read via async adapter helpers or server-only helpers when appropriate.
- Mutations that affect reports, hardware catalog, ingest queue, profile identity, or resolver caches go through `app/actions/*` or route handlers.
- Report submission flows through UI form -> `submitReportAction` -> hardware normalization -> preflight checks -> `submit_report` RPC -> mapped `Report`.
- Auth state flows through Supabase server/client wrappers in `lib/supabase/*`, cookie refresh, and `AuthButton` / `SiteHeader`.
- Styling flows from `globals.css` and Tailwind/shadcn component conventions into `components/`.

## AI Rules
- Before changing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`; this repo uses Next.js 16 with breaking differences from older knowledge.
- Do not import `@/lib/mock-data` directly in pages, layouts, or route UI. Use `@/lib/data`.
- Do not import service-role Supabase helpers into client components.
- Prefer async adapter helpers and React Query hooks for new data fetching; legacy sync helpers exist mainly for compatibility.
- Keep route handlers and server actions explicit about auth, role checks, and whether they are public, owner-only, moderator-only, or service-role operations.
- Preserve the zero-config demo path: missing Supabase keys must not break public pages.
- Keep UI pages focused on composition; move reusable product UI to `components/` and domain logic to `lib/`.

## Common Changes
- Adding a page: add the App Router file, compose existing components, fetch through `@/lib/data`, and update navigation only if the route is user-facing.
- Adding a report field: update `lib/types.ts`, `lib/data.ts` mappers, `supabase/schema.sql` and RPCs, `app/actions/reports.ts`, the submit UI, display components, and tests.
- Adding a protected admin operation: add or update an action, verify role checks through `lib/admin-access.ts` or RLS, then expose it in `app/admin/page.tsx`.
- Changing auth behavior: update the relevant `auth/**` page/route, Supabase wrapper expectations, and any profile/header components that react to session state.
- Changing global theme or tier visuals: update `globals.css` and verify `components/report-card.tsx`, `components/performance-badge.tsx`, charts, and dashboard surfaces.

## Verification
- For route, action, or type changes: run `npm run lint`.
- For pure data behavior touched through app flows: run `npm run test`.
- For Next.js routing, layouts, server actions, or route handlers: run `npm run build`.
- For visual changes: run the dev server with `npm run dev` and inspect the affected route.

## Related Context
- `../components/context.md`
- `../lib/context.md`
- `../supabase/context.md`
- `../tests/context.md`
