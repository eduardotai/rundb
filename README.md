# RunDB

**Real PC hardware + measured in-game performance database.**  
The ProtonDB for actual PCs: answer "Can my PC run this game? At what settings? What do people with similar hardware actually use?"

## Try it instantly (zero config)
```bash
npm install
npm run dev
```
Open http://localhost:3000 — everything works in the browser with rich mock data + localStorage. Submit reports, save a rig, see predictions and similarity.

## Run with real community data (Supabase)
1. Copy `.env.example` → `.env.local` and fill Supabase keys + set `NEXT_PUBLIC_USE_REAL_DATA=true`.
2. Run the schema: `npx tsx scripts/setup-supabase-real.ts` (or paste supabase/schema.sql).
3. Seed hardware catalog: `npm run seed:hardware`.
4. (Optional but recommended) Ingest real games: `npm run ingest:games`.
5. `npm run dev`

See `.env.example` and `context/` for full details. The app never breaks — real mode falls back silently.

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

## What you'll experience
- Strong home with embedded compatibility checker and trending games (real stats when available)
- Game pages with official requirements, community aggregates, powerful filters, and beautiful ReportCards
- Global reports browser with cross-game filtering
- "My Rig" persists (localStorage or DB) and powers personalized similarity + predictions everywhere
- Fast submit with validation; reports appear immediately in demo or enter moderation queue in real mode

## Key concepts (30 seconds)
- **ReportCard** — the heart of the product: dense but scannable in <2 seconds
- **Hardware catalog + detection** — structured real CPUs/GPUs + browser/paste (dxdiag/inxi style) for accurate similarity
- **Dual mode** — demo always works perfectly; real mode (`NEXT_PUBLIC_USE_REAL_DATA=true`) uses Supabase with defensive fallbacks so the app is never broken
- **Similarity** — calculated client-side from the same pure functions whether data is mocked or live
- Everything flows through the single `lib/data.ts` adapter (never import mock or Supabase directly from UI)

## For developers & contributors
The single most important file is `lib/data.ts` — the universal adapter that makes dual-mode possible.

Deep context and "how everything fits together" lives in the `context/` directory (start with `context/README.md` and `context/project-overview.md`).

- Hardware work: `context/lib-hardware.md`
- Data layer & types: `context/lib-data-and-types.md`
- Components: `context/components.md`
- Ingestion: `context/ingestion-pipeline.md`

Scripts for seeding, ingesting, etc. live in `scripts/` and have detailed headers.

## Tech, credits & history
Next.js 16 (App Router), TypeScript, Tailwind + shadcn/ui, React Query, Supabase (optional), Lucide, Sonner.

Inspired by ProtonDB, PCPartPicker, and HowLongToBeat.

This project evolved through careful phased migration from a beautiful zero-config mock demo to a production-grade real-data platform with hardware catalog, ingestion, and admin tools. Full historical verification and phase records are preserved in `docs/archive/historical-phase-5-and-verification/`.

---

**Ready to impress.** Run `npm run dev` and spend a few minutes clicking around — the ReportCards and Compatibility Checker (now with clearer "how it works" guidance) are the stars.