# RunDB

**Real PC hardware + in-game performance database.**  
The ProtonDB for actual PCs: "Can my PC run this game? At what settings? What configs and tweaks do people with similar hardware actually use?"

Built as a beautiful, self-contained frontend demo with rich mock data that feels alive. All data persists in your browser via localStorage so submitted reports and your saved rig survive refreshes.

## Features (MVP)

- **Home** — Strong value proposition, quick compatibility checker, trending games, recent community reports, aggregate stats
- **Browse Games** — Search + genre + performance tier filters, sortable grid
- **Game Detail** (`/games/[slug]`) — Official requirements, community stats (tier distribution, avg FPS by resolution), powerful report filters, beautiful ReportCards, integrated "Submit Report" flow, and personalized compatibility section
- **Submit Report** — Fast, validated form (RHF + Zod). Adds realistic reports that immediately appear in lists and update stats
- **Compatibility Checker** — Save your rig (CPU/GPU/RAM/res) once. See predicted performance tier + matching historical reports across games
- **Advanced Reports Browser** — Global filtering across every game + hardware configuration with dense table view
- **Premium UI** — Deep navy/black ProtonDB-inspired theme, data-dense but scannable ReportCards (the heart of the product), colored performance badges (Excellent = green/cyan, Good = blue, etc.), excellent typography, responsive

## Tech Stack

- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind CSS + shadcn/ui
- React Hook Form + Zod
- TanStack Table (used lightly in reports browser)
- Lucide icons + Sonner toasts + framer-motion (light)
- Pure mock data in `lib/mock-data.ts` (18 games, 55+ realistic reports)
- **Hardware Catalog** (Phase 6+ — now live): Structured database of real CPUs/GPUs with `perfIndex`. Powers beautiful autocomplete in Submit/Profile/Compatibility, much smarter similarity, and future validation. 
  - **Static mode** (default): Zero-config, works everywhere.
  - **Live production mode**: Set `NEXT_PUBLIC_USE_REAL_DATA=true` + run the `hardware_catalog` table (see `supabase/schema.sql`). Admin can seed + manage entries live. The combobox and predictions automatically prefer live data.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

Everything works instantly — no env vars, no backend, no accounts.

## Project Structure (Key Files)

```
app/
  layout.tsx                 # SiteHeader + Toaster + metadata
  page.tsx                   # Hero + embedded CompatibilityChecker + trending + recent reports
  games/
    page.tsx                 # Browse with search + filters
    [slug]/page.tsx          # Full game detail (stats, filters, ReportCards, submit)
  reports/page.tsx           # Advanced global reports browser
  compatibility/page.tsx     # Dedicated checker
  submit/page.tsx            # Standalone submit entry point
components/
  report-card.tsx            # ★ The heart of the product
  performance-badge.tsx
  game-card.tsx
  compatibility-checker.tsx  # Reusable "My Rig" + predictions
  submit-report-dialog.tsx   # Full RHF+Zod form in dialog
lib/
  mock-data.ts               # All games + reports + helpers + localStorage persistence
  types.ts
  utils.ts                   # cn() + future helpers
```

## How the Demo "Community" Works

- Seed data lives in `lib/mock-data.ts`
- User-submitted reports are saved to `localStorage` under `rundb_user_reports` and merged at load
- Your saved rig lives under `rundb_my_rig`
- Submit a few reports on different games — refresh the browser — they’re still there

## Extending the Mock Data

1. Add a new game object to the `GAMES` array in `lib/mock-data.ts`
2. Add 2–6 realistic `Report` entries pointing to the new `gameId`
3. (Optional) Update `getTrendingGames` logic if needed

The helper functions (`computeGameStats`, `predictForUserRig`, `filterReports`, etc.) will automatically pick up the new data.

## Phase 1: Real Game Data Ingestion (New)

We now have a working ingestion script:

```bash
# After getting IGDB credentials (free at https://api.igdb.com/)
npx tsx scripts/ingest-games.ts          # or npm run ingest:games
DRY_RUN=true npm run ingest:games        # safe preview
```

See `scripts/ingest-games.ts` header for full setup.

---

## Evolving to Real Backend (Supabase / Postgres)

The types in `lib/types.ts` were designed to be 1:1 with a future database.

**Suggested schema sketch (run in Supabase SQL editor):**

```sql
create table games (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  cover_url text,
  genres text[],
  release_year int,
  developer text,
  publisher text
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  user_id uuid,                 -- nullable for anonymous MVP
  cpu text not null,
  gpu text not null,
  ram int not null,
  resolution text not null,
  refresh_rate int,
  settings_preset text,
  avg_fps numeric not null,
  one_percent_low numeric,
  notes text,
  tweaks text,
  driver_version text,
  performance_tier text,
  helpful_votes int default 0,
  created_at timestamptz default now()
);

-- RLS: public read, authenticated insert on own reports, etc.
-- Add indexes on game_id, gpu, cpu, created_at, etc.
```

**Migration path:**

1. Replace `lib/mock-data.ts` data loading functions with Supabase queries (keep the same function signatures)
2. Turn `addUserReport` into a Server Action that inserts into Postgres
3. Add auth (anonymous reports still allowed)
4. Store game covers in Supabase Storage or use external URLs
5. Add real upvoting with a `votes` table + trigger to maintain `helpful_votes`

The current UI and components require almost zero changes.

## Scripts

- `npm run dev` — local development
- `npm run build` — production build (must pass cleanly)
- `npm run lint` — ESLint
- `npm run ingest:games` — **Phase 1 real-data ingestion** (see below)

## Phase 1: Real Game Data Ingestion Pipeline (IGDB + Steam + PCGamingWiki)

This is the start of the real-data migration (approved Master Plan). A robust Node/TS CLI script (`scripts/ingest-games.ts`) that:

- Fetches primary metadata, genres, companies, IDs, and images (cover + screenshots + artworks) from **IGDB** (Twitch OAuth, 4 req/s rate limit respected).
- Enriches with **Steam** Store API for `steam_app_id` + official `pc_requirements` (parsed into `official_min_reqs` / `official_rec_reqs` jsonb).
- Cross-checks / enriches via **PCGamingWiki** MediaWiki + Cargo API (30 req/min, proper User-Agent).
- Proper error handling (per-game continue), deduplication (upsert on `slug`), stores to `games` + `game_media`.
- Supports `DRY_RUN=true` for safe testing.
- Prototype ingests 8 popular games (overlap with mock data for easy switchover).

**Prerequisites**
- Run the updated `supabase/schema.sql` (includes new `game_media` table added in Phase 1).
- Add IGDB credentials to `.env.local` (see `.env.example`).
- `SUPABASE_SERVICE_ROLE_KEY` (already present) for admin writes.

**How to run**
```bash
# Dry run (recommended first)
DRY_RUN=true npx tsx scripts/ingest-games.ts

# Or with npm script (added in Phase 1)
npm run ingest:games

# Live (writes to your Supabase)
npx tsx scripts/ingest-games.ts
```

Full instructions + code are in the header comments of `scripts/ingest-games.ts`.

After successful run, flip `NEXT_PUBLIC_USE_REAL_DATA=true` and begin replacing queries in `lib/data.ts` (future Phase 1/2 work).

**PR 6 / Final Verification (Agent 6)**: See `VERIFICATION_SWARM_PROMPTS.md` (6-agent swarm), extended `scripts/phase5-e2e-real-data.ts` (real image assertions for game_media + covers + delivery), `PHASE5_PRODUCTION_READINESS_CHECKLIST.md` (updated), `FINAL_AGGREGATE_VERIFICATION_REPORT.md`, and dead code cleanup in media utils. Full docs + swarm for production readiness gate.

## Design Notes

- Deep navy `#0a0f1c` background, slate cards
- Performance tier colors are defined as CSS variables in `app/globals.css`
- ReportCard is intentionally information-dense but remains scannable in < 2 seconds
- Desktop-first with graceful mobile stacking

## License / Credits

Demo project. Feel free to use the patterns and data model for your own hardware databases.

Built with excellent taste and love for data-dense UIs (ProtonDB, PCPartPicker, HowLongToBeat).

---

**Ready to impress.** Run `npm run dev` and spend 5 minutes clicking around — the ReportCards and Compatibility Checker are the stars.
