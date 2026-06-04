# Automated Latest-Releases Game Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated importer that discovers the latest game releases from Steam's public charts and ingests the new ones into Supabase using the existing enrichment pipeline.

**Architecture:** A new pure transform + network discovery module (`lib/server/discover-steam-games.ts`) finds recent releases from Steam's `featuredcategories` API (no key). A new orchestrator script (`scripts/import-latest-games.ts`) dedups discovered candidates against the Supabase `games` table and pipes the new ones through the existing, proven `ingestGame()` (IGDB enrichment + cover/screenshot upload + upsert). Discovery is the only genuinely new logic.

**Tech Stack:** TypeScript, tsx, `node:test`, `@supabase/supabase-js`, Steam public Store API.

---

## File Structure

- **Create** `lib/server/discover-steam-games.ts` — discovery: pure transform helpers (`parseSteamReleaseYear`, `appDetailsToSeed`) + network function (`discoverLatestSteamGames`). One responsibility: turn Steam charts into a deduped `SeedGame[]`.
- **Create** `tests/discover-steam-games.test.ts` — unit tests for the pure helpers (no network).
- **Create** `scripts/import-latest-games.ts` — orchestrator: discover → dedup vs Supabase → `ingestGame()` per new seed.
- **Create** `seeds/latest-2025-2026.json` — seed file for the 10 already-curated recent titles (rollout step).
- **Modify** `package.json` — add `import:latest` npm script.

Reused as-is (do not modify): `lib/server/ingest-game.ts` (`ingestGame`), `lib/server/game-media.ts` (`ensureGameMediaBucket`), `lib/utils.ts` (`normalizeSlug`), `scripts/load-env-local.ts` (`loadEnvLocal`), `scripts/ingest-games.ts` (existing seed-file ingest, used for rollout).

---

## Task 1: Pure transform helpers + tests

Creates the discovery module with the *testable, network-free* core first.

**Files:**
- Create: `lib/server/discover-steam-games.ts`
- Test: `tests/discover-steam-games.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/discover-steam-games.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseSteamReleaseYear,
  appDetailsToSeed,
} from '../lib/server/discover-steam-games'

test('parseSteamReleaseYear extracts a 4-digit year from a Steam date string', () => {
  assert.equal(parseSteamReleaseYear('19 May, 2026'), 2026)
  assert.equal(parseSteamReleaseYear('Feb 27, 2026'), 2026)
})

test('parseSteamReleaseYear returns null when no year is present', () => {
  assert.equal(parseSteamReleaseYear('Coming soon'), null)
  assert.equal(parseSteamReleaseYear(undefined), null)
})

test('appDetailsToSeed maps a recent game to a SeedGame with a normalized slug', () => {
  const res = {
    success: true,
    data: {
      type: 'game',
      name: "Assassin's Creed Shadows",
      steam_appid: 3159330,
      release_date: { coming_soon: false, date: '20 Mar, 2025' },
    },
  }
  assert.deepEqual(appDetailsToSeed('3159330', res, { sinceYear: 2025, includeUnreleased: false }), {
    name: "Assassin's Creed Shadows",
    slug: 'assassins-creed-shadows',
    steamAppId: '3159330',
  })
})

test('appDetailsToSeed drops non-game types', () => {
  const res = {
    success: true,
    data: { type: 'dlc', name: 'Some DLC', release_date: { coming_soon: false, date: '1 Jan, 2026' } },
  }
  assert.equal(appDetailsToSeed('111', res, { sinceYear: 2025, includeUnreleased: false }), null)
})

test('appDetailsToSeed drops games older than sinceYear', () => {
  const res = {
    success: true,
    data: { type: 'game', name: 'Old Game', release_date: { coming_soon: false, date: '5 Nov, 2019' } },
  }
  assert.equal(appDetailsToSeed('222', res, { sinceYear: 2025, includeUnreleased: false }), null)
})

test('appDetailsToSeed gates coming-soon titles behind includeUnreleased', () => {
  const res = {
    success: true,
    data: { type: 'game', name: 'Future Game', release_date: { coming_soon: true, date: 'Coming soon' } },
  }
  assert.equal(appDetailsToSeed('333', res, { sinceYear: 2025, includeUnreleased: false }), null)
  assert.deepEqual(appDetailsToSeed('333', res, { sinceYear: 2025, includeUnreleased: true }), {
    name: 'Future Game',
    slug: 'future-game',
    steamAppId: '333',
  })
})

test('appDetailsToSeed returns null when the appdetails request was unsuccessful', () => {
  assert.equal(appDetailsToSeed('444', { success: false }, { sinceYear: 2025, includeUnreleased: false }), null)
  assert.equal(appDetailsToSeed('444', undefined, { sinceYear: 2025, includeUnreleased: false }), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/discover-steam-games.test.ts`
Expected: FAIL — cannot find module `../lib/server/discover-steam-games` (or exports undefined).

- [ ] **Step 3: Write minimal implementation**

Create `lib/server/discover-steam-games.ts`:

```ts
/**
 * Discover the latest game releases from Steam's public charts.
 *
 * Source: https://store.steampowered.com/api/featuredcategories (no API key).
 * Produces a deduped SeedGame[] suitable for the existing ingestGame() pipeline.
 * Pure helpers (parseSteamReleaseYear, appDetailsToSeed) are network-free and unit-tested.
 */
// Relative import (not the @/ alias) so the module resolves under `tsx --test`.
import { normalizeSlug } from '../utils'

export interface SeedGame {
  name: string
  slug: string
  steamAppId: string
}

export interface DiscoverOptions {
  /** Minimum release year to include. Default: current year - 1. */
  sinceYear?: number
  /** Include coming_soon (unreleased) titles. Default: false. */
  includeUnreleased?: boolean
  /** Cap the number of returned seeds. */
  limit?: number
}

interface SteamAppDetailsResponse {
  success?: boolean
  data?: {
    type?: string
    name?: string
    steam_appid?: number
    release_date?: { coming_soon?: boolean; date?: string }
  }
}

interface TransformOptions {
  sinceYear: number
  includeUnreleased: boolean
}

/** Extract a 4-digit year (1900–2099) from a Steam release_date string. */
export function parseSteamReleaseYear(dateStr?: string): number | null {
  if (!dateStr) return null
  const m = dateStr.match(/(?:19|20)\d{2}/)
  return m ? Number(m[0]) : null
}

/** Pure transform: one appdetails response -> SeedGame, or null if it should be skipped. */
export function appDetailsToSeed(
  appId: string,
  res: SteamAppDetailsResponse | undefined,
  opts: TransformOptions
): SeedGame | null {
  if (!res || res.success !== true || !res.data) return null
  const d = res.data
  if (d.type !== 'game') return null

  const name = (d.name || '').trim()
  if (!name) return null

  const comingSoon = d.release_date?.coming_soon === true
  if (comingSoon) {
    if (!opts.includeUnreleased) return null
  } else {
    const year = parseSteamReleaseYear(d.release_date?.date)
    if (year == null || year < opts.sinceYear) return null
  }

  return { name, slug: normalizeSlug(name), steamAppId: appId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/discover-steam-games.test.ts`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server/discover-steam-games.ts tests/discover-steam-games.test.ts
git commit -m "feat(discover): pure Steam appdetails -> SeedGame transform + tests"
```

---

## Task 2: Network discovery function

Adds the network layer to the module created in Task 1. Network calls are not unit-tested; a dry-run manual check verifies behavior.

**Files:**
- Modify: `lib/server/discover-steam-games.ts`

- [ ] **Step 1: Add HTTP helpers and the discovery function**

Append to `lib/server/discover-steam-games.ts`:

```ts
// ============================================
// NETWORK LAYER (resilient — mirrors lib/game-id-resolver.ts patterns)
// ============================================
const STEAM_RATE_MS = 200
const FETCH_TIMEOUT_MS = 8000
const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=us&l=en'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url: string, retries = 1): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RunDB-LatestImporter/1.0 (+https://store.steampowered.com/)' },
      })
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(400 * (attempt + 1))
          continue
        }
        return null
      }
      if (!res.ok) return null
      return await res.json().catch(() => null)
    } catch (err) {
      if (attempt < retries) {
        await sleep(300)
        continue
      }
      console.warn('[discover] fetch failed:', url, err instanceof Error ? err.message : err)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * Discover recent game releases from Steam's new-releases + top-sellers charts.
 * Returns a slug-deduped SeedGame[]. Throws only if the featured endpoint is unreachable.
 */
export async function discoverLatestSteamGames(opts: DiscoverOptions = {}): Promise<SeedGame[]> {
  const sinceYear = opts.sinceYear ?? new Date().getFullYear() - 1
  const includeUnreleased = opts.includeUnreleased ?? false

  const featured = await fetchJson(FEATURED_URL)
  if (!featured) {
    throw new Error('Steam featuredcategories endpoint unreachable')
  }

  const sections = ['new_releases', 'top_sellers']
  if (includeUnreleased) sections.push('coming_soon')

  const appIds = new Set<string>()
  for (const key of sections) {
    const items = featured?.[key]?.items
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it?.id != null) appIds.add(String(it.id))
      }
    }
  }

  const seeds: SeedGame[] = []
  const seenSlugs = new Set<string>()

  for (const appId of appIds) {
    if (opts.limit && seeds.length >= opts.limit) break
    await sleep(STEAM_RATE_MS)
    const detail = await fetchJson(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
    )
    const res = detail?.[appId] as SteamAppDetailsResponse | undefined
    const seed = appDetailsToSeed(appId, res, { sinceYear, includeUnreleased })
    if (seed && !seenSlugs.has(seed.slug)) {
      seeds.push(seed)
      seenSlugs.add(seed.slug)
    }
  }

  return seeds
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (exit 0). (Per project memory: do NOT run `next build` against a live dev server — use `tsc`.)

- [ ] **Step 3: Re-run the unit tests (the pure helpers must still pass)**

Run: `npx tsx --test tests/discover-steam-games.test.ts`
Expected: PASS — all 7 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add lib/server/discover-steam-games.ts
git commit -m "feat(discover): resilient Steam-charts discovery (featuredcategories + appdetails)"
```

---

## Task 3: Orchestrator script + npm command

Wires discovery → dedup vs Supabase → existing `ingestGame()`.

**Files:**
- Create: `scripts/import-latest-games.ts`
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Write the orchestrator**

Create `scripts/import-latest-games.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Discover the latest Steam releases and ingest the new ones into Supabase.
 *
 * HOW TO RUN:
 *   npm run import:latest -- --dry-run
 *   npm run import:latest
 *   npm run import:latest -- --limit=10 --since-year=2025
 *   npm run import:latest -- --include-unreleased
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   IGDB_CLIENT_ID, IGDB_CLIENT_SECRET
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnvLocal } from './load-env-local'
import { discoverLatestSteamGames } from '../lib/server/discover-steam-games'
import { ingestGame } from '../lib/server/ingest-game'
import { ensureGameMediaBucket } from '../lib/server/game-media'

loadEnvLocal()

interface Flags {
  dryRun: boolean
  limit?: number
  sinceYear?: number
  includeUnreleased: boolean
}

function parseArgs(): Flags {
  const flags: Flags = { dryRun: process.env.DRY_RUN === 'true', includeUnreleased: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-d') flags.dryRun = true
    else if (arg === '--include-unreleased') flags.includeUnreleased = true
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n > 0) flags.limit = n
    } else if (arg.startsWith('--since-year=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n)) flags.sinceYear = n
    } else if (arg.startsWith('--months=')) {
      const m = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(m) && m > 0) {
        const cutoff = new Date(Date.now() - m * 30 * 86400000)
        flags.sinceYear = cutoff.getFullYear()
      }
    }
  }
  return flags
}

async function main() {
  const flags = parseArgs()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    console.error('Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in .env.local')
    process.exit(1)
  }

  const client = createClient(url, key)
  console.log(`\n=== Import Latest Games${flags.dryRun ? ' (DRY RUN)' : ''} ===`)

  const discovered = await discoverLatestSteamGames({
    sinceYear: flags.sinceYear,
    includeUnreleased: flags.includeUnreleased,
    limit: flags.limit,
  })
  console.log(`Discovered ${discovered.length} candidate game(s) from Steam charts.`)

  const { data: existing, error } = await client.from('games').select('slug, steam_app_id')
  if (error) {
    console.error('Failed to read existing games:', error.message)
    process.exit(1)
  }
  const existingSlugs = new Set((existing || []).map((g: any) => g.slug))
  const existingAppIds = new Set(
    (existing || []).map((g: any) => g.steam_app_id).filter(Boolean).map(String)
  )
  const fresh = discovered.filter(
    (s) => !existingSlugs.has(s.slug) && !existingAppIds.has(s.steamAppId)
  )
  console.log(`${fresh.length} new (after dedup against ${existing?.length ?? 0} existing).`)
  for (const s of fresh) {
    console.log(`  • ${s.name} (${s.slug}) [appid ${s.steamAppId}]`)
  }

  if (fresh.length === 0) {
    console.log('\nNothing to import.')
    return
  }
  if (flags.dryRun) {
    console.log('\nDry run — no writes performed.')
    return
  }

  try {
    await ensureGameMediaBucket(client as any)
  } catch (e: unknown) {
    console.warn('[init] bucket warning:', e)
  }

  const stats = { success: 0, failed: 0, errors: [] as Array<{ slug: string; error: string }> }
  for (let i = 0; i < fresh.length; i++) {
    const s = fresh[i]!
    console.log(`\n[${i + 1}/${fresh.length}] ${s.name} (${s.slug})`)
    const result = await ingestGame(client, s, { onLog: (msg) => console.log(`  ${msg}`) })
    if (result.ok) {
      stats.success++
      console.log(`  SUCCESS (media=${result.mediaUploaded ?? 0})`)
    } else {
      stats.failed++
      stats.errors.push({ slug: s.slug, error: result.error ?? 'unknown' })
      console.error(`  FAILED: ${result.error}`)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`Ingested: ${stats.success}  Failed: ${stats.failed}`)
  stats.errors.slice(0, 5).forEach((e) => console.log(`  - ${e.slug}: ${e.error}`))
  process.exit(stats.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `"scripts"`, add this line after the `"ingest:worker"` entry:

```json
    "import:latest": "tsx scripts/import-latest-games.ts",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output (exit 0).

- [ ] **Step 4: Dry-run integration check (real network, no writes)**

Run: `npm run import:latest -- --dry-run --limit=5`
Expected: prints "Discovered N candidate game(s)…", a dedup line, and a bulleted list of new games, ending with "Dry run — no writes performed." Exit 0. (Requires network + valid `.env.local`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/import-latest-games.ts package.json
git commit -m "feat(scripts): import:latest — Steam-charts discovery into Supabase ingest"
```

---

## Task 4: Rollout — ingest the 10 already-curated titles

The 10 recent titles added earlier to `lib/mock-data.ts` won't all be charting, so push them to Supabase explicitly via the existing seed-file ingest so they appear in the real app.

**Files:**
- Create: `seeds/latest-2025-2026.json`

- [ ] **Step 1: Create the seed file**

Create `seeds/latest-2025-2026.json`:

```json
[
  { "name": "Resident Evil Requiem", "slug": "resident-evil-requiem", "steamAppId": "3764200" },
  { "name": "Forza Horizon 6", "slug": "forza-horizon-6", "steamAppId": "2483190" },
  { "name": "DOOM: The Dark Ages", "slug": "doom-the-dark-ages", "steamAppId": "3017860" },
  { "name": "Kingdom Come: Deliverance II", "slug": "kingdom-come-deliverance-2", "steamAppId": "1771300" },
  { "name": "Clair Obscur: Expedition 33", "slug": "clair-obscur-expedition-33", "steamAppId": "1903340" },
  { "name": "Assassin's Creed Shadows", "slug": "assassins-creed-shadows", "steamAppId": "3159330" },
  { "name": "Borderlands 4", "slug": "borderlands-4", "steamAppId": "1285190" },
  { "name": "Sid Meier's Civilization VII", "slug": "civilization-7", "steamAppId": "1295660" },
  { "name": "Avowed", "slug": "avowed", "steamAppId": "2457220" },
  { "name": "The Elder Scrolls IV: Oblivion Remastered", "slug": "oblivion-remastered", "steamAppId": "2623190" }
]
```

- [ ] **Step 2: Dry-run the existing ingest against the seed file**

Run: `npm run ingest:games -- --seed-file=seeds/latest-2025-2026.json --dry-run`
Expected: logs `10 games`, then per-game `SUCCESS (media=…)` lines under DRY RUN, summary `Success: 10  Failed: 0` (a couple may report "No IGDB match" for very new titles — that is acceptable; they still upsert as skeleton rows on the real run).

- [ ] **Step 3: Real ingest into Supabase**

Run: `npm run ingest:games -- --seed-file=seeds/latest-2025-2026.json`
Expected: per-game `SUCCESS`, summary with `Success` count. New rows land in the `games` table with covers in `game_media`.

- [ ] **Step 4: Commit the seed file**

```bash
git add seeds/latest-2025-2026.json
git commit -m "chore(seeds): curated 2025-2026 latest releases for Supabase ingest"
```

---

## Verification

- [ ] `npx tsx --test tests/discover-steam-games.test.ts` — all unit tests pass.
- [ ] `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] `npm run import:latest -- --dry-run` — lists new charting games, no writes.
- [ ] After a real `npm run import:latest` and the Task 4 ingest, open the app (real-data mode) and confirm the new games (e.g. Resident Evil Requiem, Forza Horizon 6) render with correct covers + metadata.

## Follow-ups (out of scope, do not implement now)

- Scheduling: run `npm run import:latest` on Windows Task Scheduler / cron, or wire to `/schedule`, since the run is idempotent.
- Optionally fold the Task 4 curated seed into the importer as a built-in supplementary list.
