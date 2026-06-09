# RunDB

RunDB is a community performance database for real PC hardware. It helps players answer the practical question behind every system requirement chart: **can my machine run this game, at what settings, and what did people with similar hardware actually report?**

Think of it as a ProtonDB-style experience for measured FPS, graphics settings, hardware profiles, tweaks, and compatibility confidence across real CPUs, GPUs, RAM, drivers, kernels, and resolutions.

## Highlights

- Real-world performance reports with CPU, GPU, RAM, resolution, preset, average FPS, 1% lows, notes, issues, and tweaks.
- Hardware-aware compatibility predictions based on saved rigs and reports from similar systems.
- Dense, scannable report cards built for fast comparison instead of vague "minimum spec" guessing.
- Supabase-backed real data mode with defensive fallbacks for local development and demos.
- Structured hardware catalog, normalization, aliases, browser detection, and paste-based rig capture.
- Game ingestion pipeline for IGDB, Steam, PCGamingWiki, ProtonDB-style seed queues, covers, metadata, and media.
- Admin-oriented moderation and queue tooling for growing the catalog without hand-curating every title.

## Product Loop

RunDB works as a feedback loop between a player's saved hardware profile and the community's measured reports.

1. Save a rig with CPU, GPU, RAM, resolution, and optional driver, kernel, or distro details.
2. Browse games and compare aggregate FPS, performance tiers, covers, and community reports.
3. Filter reports by hardware, settings, resolution, and similarity to your own machine.
4. Submit measured FPS, graphics settings, notes, issues, and tweaks from your own session.
5. Moderators approve useful reports, and approved data improves future compatibility predictions.

## Tech Stack

- **Framework:** Next.js 16 App Router, React 19, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui, Radix UI, Lucide icons
- **Data:** Supabase Auth, Postgres, Storage, RLS, server actions, RPCs
- **State:** TanStack React Query
- **Forms:** React Hook Form, Zod
- **Scripts:** TSX-based ingestion, seeding, verification, and maintenance tools
- **CI:** GitHub Actions for install, lint, and build

> This project uses a newer Next.js version with breaking API and file-structure changes. Before changing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`.

## Repository Structure

```text
app/                 Next.js App Router pages, layouts, route handlers, and server actions
components/          Product UI, report cards, hardware inputs, admin tools, and shadcn/ui primitives
docs/                Historical phase notes and supporting documentation
lib/                 Data adapter, Supabase clients, domain logic, hardware/catalog helpers, and server utilities
public/              Static assets and public catalog metadata
scripts/             Ingestion, seeding, verification, repair, and publishing scripts
seeds/               Seed datasets used by catalog and queue scripts
supabase/            Production schema, incremental SQL, and email templates
tests/               Node test runner coverage for pure logic and ingestion helpers
```

## Getting Started

### Requirements

- Node.js 20+
- npm
- Supabase project for real data mode
- Optional IGDB/Twitch credentials for full game ingestion
- Optional Steam Web API key for account linking and profile enrichment

### Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app can run without a live Supabase project when mock data is enabled for development. Public deploys should use real Supabase keys and keep mock fallback disabled unless deliberately testing demo behavior.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values you need:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Real mode | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Real mode | Public Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server ops | Server-only key for ingest, privileged actions, and maintenance scripts |
| `NEXT_PUBLIC_USE_REAL_DATA` | Recommended | Enables Supabase-backed reads and writes |
| `NEXT_PUBLIC_ALLOW_MOCK_DATA` | Development only | Allows local mock data behavior when explicitly enabled |
| `IGDB_CLIENT_ID` | Ingest only | Twitch/IGDB client ID for game metadata |
| `IGDB_CLIENT_SECRET` | Ingest only | Twitch/IGDB client secret |
| `STEAM_WEB_API_KEY` | Optional | Steam profile, account linking, and enrichment support |

Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code or public build output.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server with webpack |
| `npm run build` | Build the production app |
| `npm run start` | Start the built production app |
| `npm run lint` | Run ESLint |
| `npm run test` | Run the Node test suite |
| `npm run setup:supabase` | Prepare a Supabase project for real data |
| `npm run seed:hardware` | Seed the hardware catalog |
| `npm run verify:hardware` | Validate the hardware catalog |
| `npm run seed:games` | Seed starter games |
| `npm run build:seed` | Build a larger game seed queue |
| `npm run seed:queue` | Populate the ingest queue |
| `npm run ingest:games` | Run direct game ingestion |
| `npm run ingest:worker -- --batch=50` | Process queued game ingestion in batches |
| `npm run import:latest` | Import latest game candidates |
| `npm run reingest:covers` | Refresh covers and media |

## Public Deploy Prep

1. Create a Supabase project.
2. Add the required environment variables to your host.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Seed hardware with `npm run seed:hardware`.
5. Seed starter games with `npm run seed:games`.
6. Build and populate the larger queue with `npm run build:seed` and `npm run seed:queue`.
7. Enrich games with `npm run ingest:worker -- --batch=50`.
8. Verify locally with `npm run lint`, `npm run test`, and `npm run build`.

## Data Model

RunDB centers on a few core entities:

- **Games:** searchable catalog rows with slugs, external IDs, covers, genres, requirements, and ingest status.
- **Reports:** measured performance entries tied to games, hardware, settings, FPS, notes, votes, and moderation status.
- **Profiles:** Supabase Auth extensions for username, avatar, role, and primary rig mirror fields.
- **User rigs:** saved hardware profiles used by compatibility predictions and report prefill.
- **Hardware catalog:** canonical CPU/GPU entries, aliases, metadata, and performance indexes.
- **Game media:** covers, screenshots, artworks, attribution, source metadata, and storage URLs.
- **Ingest queue:** background enrichment jobs for growing the catalog safely.

See `supabase/schema.sql` and `lib/types.ts` for the source-of-truth shapes.

## Architecture Notes

The most important architectural rule is that app surfaces should go through the shared data adapter in `lib/data.ts`. It centralizes real-vs-mock behavior, Supabase mapping, fallbacks, React Query hooks, report aggregation, cover enrichment, and hardware-aware prediction helpers.

Supabase clients are defensive by design. Missing keys, slow auth calls, or unreachable services should not break the local demo path. Real deploys still rely on RLS, server actions, and SECURITY DEFINER RPCs for protected writes.

For deeper onboarding, start with the root guide and then the relevant folder-level context file:

- `CONTEXT.md`
- `app/context.md`
- `components/context.md`
- `lib/context.md`
- `scripts/context.md`
- `supabase/context.md`
- `tests/context.md`
- `seeds/context.md`
- `public/context.md`

## Game Ingestion Pipeline

RunDB grows its game catalog in two phases:

1. Insert skeleton game rows quickly from seed data, admin bulk import, or queue sources.
2. Enrich those rows in the background with IGDB, Steam, PCGamingWiki, cover media, screenshots, requirements, and attribution.

This keeps the public app usable while large catalogs are being processed. Failed rows remain visible in the queue for retry and debugging.

## Security and Moderation

- Public report reads are limited to approved content.
- Report submission goes through server actions and database RPCs for validation, rate limiting, duplicate checks, and tier calculation.
- Moderator and admin access is controlled through `profiles.role` plus RLS policies.
- Service-role access is reserved for server-only scripts, ingestion, maintenance, and privileged actions.
- Anonymous and signed-in contribution flows are supported, with real deploys expected to moderate new reports before public display.

## Current Migration Notes

RunDB is in active migration from a polished mock/localStorage prototype to a production real-data platform. The public game, report, profile, rig, hardware, and ingestion paths are designed for real Supabase operation. Some admin moderation and bulk-management helpers are still migration areas; start with `app/context.md`, `lib/context.md`, and `supabase/context.md` for the current notes.

## Contributing

1. Read `AGENTS.md`, `CONTEXT.md`, and the relevant folder's `context.md`.
2. Keep changes scoped and route data access through `lib/data.ts` or server-only helpers.
3. Update schema, types, mappers, RPCs, actions, forms, and docs together when adding fields.
4. Prefer focused tests for pure logic and risky data transformations.
5. Run `npm run lint`, `npm run test`, and `npm run build` before opening a pull request.

Pull requests should use `.github/pull_request_template.md` and call out migrations, environment variables, verification steps, and follow-up work.

## Changelog

Release notes live in [`CHANGELOG.md`](./CHANGELOG.md).

## Community and Maintenance

- Contribution guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](./SECURITY.md)
- Pull request template: [`.github/pull_request_template.md`](./.github/pull_request_template.md)
- CI workflow: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

## License

No license file is currently included. Add one before distributing, forking, or accepting broad external contributions.
