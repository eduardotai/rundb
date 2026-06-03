# RunDB

**Real PC hardware + measured in-game performance database.**
The ProtonDB for actual PCs: answer "Can my PC run this game? At what settings? What do people with similar hardware actually use?"

## Local Development
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open http://localhost:3000. Public data comes from Supabase, with a starter catalog of real games available so users can browse and submit reports. Fake reports and demo admin state are disabled unless you explicitly set `NEXT_PUBLIC_ALLOW_MOCK_DATA=true` in development.

## Public Deploy Prep
1. Fill `.env.local` or your host env vars with real Supabase keys.
2. Run the schema from `supabase/schema.sql`.
3. Seed hardware catalog: `npm run seed:hardware`.
4. Seed the starter game catalog: `npm run seed:games`.
5. Build the larger real game queue: `npm run build:seed`.
6. Populate the queue: `npm run seed:queue`.
7. Enrich games and covers: `npm run ingest:worker -- --batch=50`.
8. Verify: `npm run build`.

## How the value loop works

RunDB is a closed loop: your rig + real reports from similar hardware produce better predictions for you, and your reports help everyone else.

```mermaid
flowchart TD
    A[1. Save Your Rig<br/>CPU / GPU / RAM / Resolution<br/>(+ optional hardware detection)] --> B[2. Browse or Check Compatibility<br/>See real tier distributions, avg FPS by resolution, and community stats]
    B --> C[3. Read ReportCards<br/>Exact hardware + settings + FPS (avg + 1% low)<br/>+ similar-to-your-rig highlights]
    C --> D[4. Submit your own report<br/>Fast validated form, under a minute]
    D --> E[Moderation approval<br/>Approved reports improve public stats]
    E --> A
```

## Key Concepts
- **ReportCard**: dense but scannable real hardware, settings, FPS, tier, tweaks, and similarity context.
- **Hardware catalog + detection**: structured real CPUs/GPUs plus browser/paste capture for accurate similarity.
- **Real data adapter**: UI reads go through `lib/data.ts`; public deploys keep real starter games available but do not fall back to fake reports or demo state.
- **Ingestion pipeline**: ProtonDB seed queue plus IGDB/Steam enrichment builds the public game catalog.

## Tech
Next.js 16 App Router, TypeScript, Tailwind + shadcn/ui, React Query, Supabase, Lucide, Sonner.
