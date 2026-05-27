/**
 * RunDB Phase 1 Game Data Ingestion Prototype
 *
 * - Connects to IGDB (Twitch client credentials OAuth)
 * - Fetches a list of popular PC games dynamically via IGDB API (where platforms=(6) [PC],
 *   total_rating_count > threshold, sort total_rating_count desc, limit ~10)
 * - Upserts into Supabase `games` table using the APPROVED schema (supabase/schema.sql)
 * - Downloads cover images from IGDB (high quality), uploads + optimizes (Sharp webp via shared util)
 *   to Supabase Storage bucket "game-media"
 * - Sets games.cover_url to the permanent hosted public URL
 * - Inserts into `game_media` (correct FK game_id, media_type='cover', hosted url, attribution)
 *
 * Includes:
 * - Rate limiting (300ms between IGDB calls to respect ~4 req/s)
 * - Error handling (per-game continue, summary)
 * - Idempotent: upsert on slug (UNIQUE in schema); safe to re-run
 * - DRY_RUN=true for safe local testing (no DB/storage writes)
 *
 * HOW TO RUN LOCALLY:
 *   1. In Supabase SQL Editor: run the full supabase/schema.sql (ensures games + game_media tables,
 *      indexes, RLS, triggers).
 *   2. (Optional but recommended) In Supabase Dashboard > Storage: create public bucket named "game-media"
 *      (fileSizeLimit 10MB, allowed image/* ; or script will try to create via service_role).
 *   3. Copy .env.example to .env.local (or use existing). Set:
 *        IGDB_CLIENT_ID=...          (get free from https://dev.twitch.tv/console/apps -> new app, category IGDB)
 *        IGDB_CLIENT_SECRET=...
 *        SUPABASE_SERVICE_ROLE_KEY=...  (from Supabase project settings > API; never expose)
 *        (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL already set for anon)
 *   4. Test safely: DRY_RUN=true npx tsx scripts/ingest-games.ts
 *   5. Live run: npx tsx scripts/ingest-games.ts
 *      (Also works via: npm run ingest:games)
 *
 * After run: Check Supabase Table Editor for games + game_media rows. cover_url will be
 * https://...supabase.co/storage/v1/object/public/game-media/games/slug/cover.webp
 * Re-runs are idempotent (updates last_ingested_at etc).
 *
 * Agent 4 (PR 4): exact 18 games + shared normalizeSlug for clean slugs in seed/JSON/popular.
 * Admin UI now has protected Server Action trigger + preview thumbnails + enhanced bulk dialog.
 *
 * Uses approved schema exactly. Leverages lib/utils.ts for optimizeAndUpload + ensure bucket + normalizeSlug.
 * See root README.md (Phase 1 section) and .env.example for more.
 *
 * Deps: @supabase/supabase-js, sharp (for optimize), tsx. Native fetch/Buffer.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Phase 1 approved image pipeline utils (handles sharp optimize to webp + upload to correct 'game-media' bucket)
import {
  ensureGameMediaBucket,
  optimizeAndUploadToGameMedia,
} from '../lib/server/game-media';

// Agent 4 / PR 4: shared clean slug normalizer for exact 18 games match + bulk/seed
import { normalizeSlug } from '../lib/utils';

// Lazy / guarded client (top level creation would fail without envs in tests/CI)
let supabase: ReturnType<typeof createClient> | null = null;
function getSupabaseClient() {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for media pipeline (use service role)');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;
let DRY_RUN = process.env.DRY_RUN === 'true';

// Rate limiting for IGDB (~4 req/s limit; use 300ms throttle)
const RATE_LIMIT_MS = 300;

// ============================================
// CLI FLAGS + JSON SEED LIST SUPPORT (for admin /admin UI + more games)
// Supports: --dry-run , --seed-json='[{"name":"..","slug":".."}, ...]' , --limit=N , --fetch-popular
// Env: SEED_JSON=... also works. No extra files created; inline JSON or built-in default.
// Agent 4: uses normalizeSlug for clean handling of exact current 18 games.
// ============================================
interface SeedGame { name: string; slug: string; }

const DEFAULT_SEED_GAMES: SeedGame[] = [
  // Exact current 18 games from lib/mock-data.ts (canonical slugs for consistency with app routes + real data switchover)
  // Agent 4 requirement: clean handling via normalizeSlug + explicit pairs
  { name: 'Cyberpunk 2077', slug: 'cyberpunk-2077' },
  { name: 'Elden Ring', slug: 'elden-ring' },
  { name: 'Black Myth: Wukong', slug: 'black-myth-wukong' },
  { name: 'Starfield', slug: 'starfield' },
  { name: "Baldur's Gate 3", slug: 'baldurs-gate-3' },
  { name: 'Helldivers 2', slug: 'helldivers-2' },
  { name: 'Alan Wake 2', slug: 'alan-wake-2' },
  { name: 'Hogwarts Legacy', slug: 'hogwarts-legacy' },
  { name: 'The Witcher 3: Wild Hunt', slug: 'the-witcher-3' },
  { name: 'Counter-Strike 2', slug: 'counter-strike-2' },
  { name: 'VALORANT', slug: 'valorant' },
  { name: 'League of Legends', slug: 'league-of-legends' },
  { name: 'Dragon Age: The Veilguard', slug: 'dragon-age-veilguard' },
  { name: 'Monster Hunter Wilds', slug: 'monster-hunter-wilds' },
  { name: 'Palworld', slug: 'palworld' },
  { name: 'Hades II', slug: 'hades-2' },
  { name: 'Warhammer 40,000: Darktide', slug: 'warhammer-darktide' },
  { name: 'Factorio', slug: 'factorio' },
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg === '--dry-run' || arg === '-d') {
      flags.dryRun = true;
    } else if (arg.startsWith('--seed-json=')) {
      flags.seedJson = arg.split('=')[1] || '';
    } else if (arg.startsWith('--limit=')) {
      flags.limit = arg.split('=')[1] || '';
    } else if (arg === '--fetch-popular' || arg === '--popular') {
      flags.fetchPopular = true;
    } else if (arg === '--admin-trigger') {
      flags.adminTrigger = true; // simple marker for /admin UI flows
    }
  }
  // Env override for dry (common in npm scripts)
  if (process.env.DRY_RUN === 'true') flags.dryRun = true;
  return flags;
}

function loadSeedGames(flags: Record<string, string | boolean>): SeedGame[] {
  let games: SeedGame[] = [...DEFAULT_SEED_GAMES];

  // JSON seed list from env or --seed-json (preferred for admin /admin UI generated cmds)
  const seedJson = (flags.seedJson as string) || process.env.SEED_JSON;
  if (seedJson && seedJson.trim()) {
    try {
      const parsed = JSON.parse(seedJson.trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        games = parsed.map((g: any) => {
          const name = String(g.name || g.Name || '').trim();
          const provided = String(g.slug || g.Slug || '').trim();
          const slug = provided || normalizeSlug(name);
          return { name, slug };
        }).filter((g: SeedGame) => g.name && g.slug);
        console.log(`[seed] Loaded ${games.length} games from SEED_JSON / --seed-json (normalized via shared normalizeSlug)`);
      }
    } catch (e: any) {
      console.warn('[seed] Failed to parse SEED_JSON, using default:', e.message);
    }
  }

  // Limit support
  if (flags.limit) {
    const n = parseInt(String(flags.limit), 10);
    if (!isNaN(n) && n > 0) games = games.slice(0, n);
  }

  return games;
}

if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
  console.error('Missing IGDB_CLIENT_ID or IGDB_CLIENT_SECRET in .env.local');
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let igdbToken: string | null = null;
let igdbTokenExpiry = 0;

async function getIgdbToken(): Promise<string> {
  const now = Date.now();
  if (igdbToken && now < igdbTokenExpiry) return igdbToken;

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: IGDB_CLIENT_ID!,
      client_secret: IGDB_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`IGDB token fetch failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  igdbToken = data.access_token;
  igdbTokenExpiry = now + (data.expires_in - 60) * 1000; // 1min buffer
  return igdbToken!;
}

async function igdbRequest(endpoint: string, body: string): Promise<any[]> {
  await sleep(RATE_LIMIT_MS); // rate limit
  const token = await getIgdbToken();
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': IGDB_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  if (res.status === 429) {
    console.warn('[IGDB] Rate limited (429), backing off 2s...');
    await sleep(2000);
    return igdbRequest(endpoint, body);
  }
  if (!res.ok) {
    const txt = await res.text();
    console.error('IGDB error', res.status, txt);
    throw new Error(`IGDB ${endpoint} error ${res.status}: ${txt}`);
  }
  return res.json();
}

async function uploadImageToStorage(
  url: string,
  gameSlug: string,
  type: string,
  attribution: string
): Promise<string | null> {
  const client = getSupabaseClient();
  if (DRY_RUN) {
    console.log(`[DRY] Would download+Sharp-optimize+upload: ${url} -> game-media/games/${gameSlug}/${type}.webp`);
    return `https://example.supabase.co/storage/v1/object/public/game-media/games/${gameSlug}/${type}.webp`;
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'RunDB-Phase1/1.0' } });
  if (!response.ok) {
    console.error('Download failed', url, response.status);
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const destPath = `games/${gameSlug}/${type}.webp`;
  try {
    // Use the shared Phase 1 pipeline util (Sharp webp optimize + correct bucket + long cache)
    const publicUrl = await optimizeAndUploadToGameMedia(client as any, buffer, destPath, {
      width: type.startsWith('cover') ? 1200 : 1280,
      quality: 82,
      format: 'webp',
    });
    return publicUrl;
  } catch (e: any) {
    console.error('optimizeAndUpload failed', e.message || e);
    return null;
  }
}

async function fetchPopularPcGames(limit = 10): Promise<SeedGame[]> {
  console.log(`[dynamic] Fetching top ${limit} popular PC games from IGDB (platforms=6, high rating_count)...`);
  try {
    // Note: IGDB 'where' syntax for platforms array + sort; may need adjustment based on exact API response shape
    const results = await igdbRequest('games', `
      fields id,name,slug;
      where platforms = (6) & total_rating_count > 800;
      sort total_rating_count desc;
      limit ${limit};
    `);
    return results
      .map((g: any) => ({
        name: g.name,
        slug: g.slug || normalizeSlug(g.name),
      }))
      .filter((g: SeedGame) => g.name && g.slug);
  } catch (e: any) {
    console.warn('[dynamic] Popular fetch failed, falling back to default seed:', e.message);
    return [];
  }
}

async function main() {
  const cliFlags = parseCliArgs();
  if (cliFlags.dryRun) {
    DRY_RUN = true;
  }

  const seedGames = loadSeedGames(cliFlags);

  let GAMES_TO_INGEST: SeedGame[] = seedGames;

  if (cliFlags.fetchPopular) {
    const popular = await fetchPopularPcGames(cliFlags.limit ? parseInt(String(cliFlags.limit)) : 12);
    if (popular.length > 0) GAMES_TO_INGEST = popular;
  }

  console.log(`\n=== Starting Phase 1 Ingestion${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  console.log(`Seed source: ${cliFlags.fetchPopular ? 'IGDB popular PC' : (cliFlags.seedJson || process.env.SEED_JSON ? 'JSON seed list (from admin/CLI)' : 'built-in DEFAULT_SEED_GAMES')} (${GAMES_TO_INGEST.length} games)`);
  if (cliFlags.adminTrigger) {
    console.log('[admin] Triggered via /admin UI generated command / flag');
  }

  const startTime = Date.now();
  const stats = {
    total: GAMES_TO_INGEST.length,
    processed: 0,
    success: 0,
    failed: 0,
    mediaUploaded: 0,
    errors: [] as Array<{ slug: string; error: string }>,
  };

  // Phase 1 image strategy: ensure our Storage bucket exists (idempotent, guidance in lib/utils.ts)
  try {
    const clientForBucket = getSupabaseClient();
    await ensureGameMediaBucket(clientForBucket as any);
    console.log('game-media bucket ensured (public, for optimized covers/screenshots)');
  } catch (e: any) {
    console.warn('[init] ensureGameMediaBucket warning (continuing):', e.message || e);
  }

  for (let i = 0; i < GAMES_TO_INGEST.length; i++) {
    const gameInfo = GAMES_TO_INGEST[i];
    const progress = `[${i + 1}/${GAMES_TO_INGEST.length}]`;
    console.log(`\n${progress} Processing "${gameInfo.name}" (slug: ${gameInfo.slug}) ...`);
    stats.processed++;

    try {
      // 1. Search IGDB (improved fields for images + ids + companies)
      console.log(`  ${progress} Fetching metadata + images from IGDB...`);
      const igdbGames = await igdbRequest('games', `
        search "${gameInfo.name}";
        fields id,name,slug,genres.name,release_dates.y,first_release_date,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,cover.image_id,cover.url,screenshots.image_id,screenshots.url,artworks.image_id,external_games.uid,external_games.category;
        limit 1;
      `);

      if (!igdbGames.length) {
        console.warn(`  ${progress} No IGDB match for ${gameInfo.name}`);
        stats.errors.push({ slug: gameInfo.slug, error: 'No IGDB match' });
        continue;
      }

      const igdbGame = igdbGames[0];
      const igdbId = String(igdbGame.id);

      // Extract dev/pub better from involved_companies
      const involved = igdbGame.involved_companies || [];
      const devEntry = involved.find((c: any) => c.developer);
      const pubEntry = involved.find((c: any) => c.publisher);
      const developer = devEntry?.company?.name || igdbGame.developer || null;
      const publisher = pubEntry?.company?.name || igdbGame.publisher || developer;

      // 2. Basic game mapping + upsert (to get real uuid id for game_media FK) + last_ingested_at
      const nowIso = new Date().toISOString();
      const gameRow: any = {
        slug: gameInfo.slug,
        name: igdbGame.name,
        igdb_id: igdbId,
        genres: (igdbGame.genres || []).map((g: any) => g.name),
        release_year: igdbGame.release_dates?.[0]?.y || (igdbGame.first_release_date ? new Date(igdbGame.first_release_date * 1000).getFullYear() : null),
        developer,
        publisher,
        cover_url: null,
        last_ingested_at: nowIso,
        // steam_app_id / official_* + igdb_id now resolvable via lib/game-id-resolver (Agent 5 Public API Resilience Layer)
        // Recommended: pre-resolve using resolveGameExternalIds(name, slug) before insert to populate + store attribution.
      };

      let gameId: string | null = null;
      if (!DRY_RUN) {
        const client = getSupabaseClient();
        const { error, data } = await client.from('games').upsert(gameRow, { onConflict: 'slug' }).select('id').single();
        if (error) {
          console.error(`  ${progress} Game upsert error`, error);
          stats.errors.push({ slug: gameInfo.slug, error: `Upsert: ${error.message}` });
          continue;
        } else {
          gameId = (data as any)?.id || null;
          console.log(`  ${progress} Upserted game (id=${gameId})`);
        }
      } else {
        console.log(`  ${progress} [DRY] Would upsert game row:`, JSON.stringify({ ...gameRow, cover_url: '[optimized later]' }));
        gameId = 'dry-run-uuid-' + gameInfo.slug;
      }

      // 3. FULL IMAGE PIPELINE: build list of remote sources (prefer image_id for quality urls)
      const mediaToProcess: Array<{ remoteUrl: string; type: string; sort: number; attr: string }> = [];
      const ATTRIB = 'Sourced from IGDB (https://www.igdb.com). Images © respective copyright holders. Used for non-commercial informational purposes.';

      if (igdbGame.cover?.image_id) {
        mediaToProcess.push({
          remoteUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/${igdbGame.cover.image_id}.jpg`,
          type: 'cover',
          sort: 0,
          attr: ATTRIB,
        });
      } else if (igdbGame.cover?.url) {
        mediaToProcess.push({
          remoteUrl: 'https:' + igdbGame.cover.url.replace('t_thumb', 't_cover_big'),
          type: 'cover',
          sort: 0,
          attr: ATTRIB,
        });
      }

      const ss = (igdbGame.screenshots || []).slice(0, 3);
      ss.forEach((s: any, idx: number) => {
        const u = s.image_id
          ? `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${s.image_id}.jpg`
          : 'https:' + (s.url || '').replace('t_thumb', 't_screenshot_big');
        if (u) mediaToProcess.push({ remoteUrl: u, type: `screenshot-${idx}`, sort: 10 + idx, attr: ATTRIB });
      });

      console.log(`  ${progress} Image pipeline: ${mediaToProcess.length} items (cover + screenshots)`);

      // 4. Process each: download → Sharp optimize via util → Storage upload → correct DB insert
      let uploadedCoverForGame: string | null = null;
      let mediaCount = 0;

      for (let j = 0; j < mediaToProcess.length; j++) {
        const m = mediaToProcess[j];
        const sub = `    (${j + 1}/${mediaToProcess.length})`;
        console.log(`  ${progress} ${sub} ${m.type}: downloading + optimizing...`);
        const publicUrl = await uploadImageToStorage(m.remoteUrl, gameInfo.slug, m.type, m.attr);
        if (publicUrl) {
          if (m.type === 'cover') uploadedCoverForGame = publicUrl;

          if (!DRY_RUN && gameId) {
            const insertRow: any = {
              game_id: gameId,
              media_type: m.type.startsWith('screenshot') ? 'screenshot' : m.type === 'cover' ? 'cover' : 'artwork',
              url: publicUrl,
              thumbnail_url: publicUrl,
              sort_order: m.sort,
              source: 'igdb',
              external_id: m.remoteUrl.split('/').pop()?.split('.')[0] || null,
              attribution: m.attr,
            };
            const client = getSupabaseClient();
            const { error } = await client.from('game_media').insert(insertRow);
            if (error) {
              console.error(`  ${progress} ${sub} game_media insert error`, error);
            } else {
              mediaCount++;
              stats.mediaUploaded++;
            }
          } else if (DRY_RUN) {
            mediaCount++;
          }
        }
      }

      // Update games.cover_url with our optimized Storage version + last_ingested
      if (uploadedCoverForGame && !DRY_RUN && gameId) {
        const client = getSupabaseClient();
        await (client.from('games') as any)
          .update({ cover_url: uploadedCoverForGame, last_ingested_at: nowIso })
          .eq('id', gameId);
      }

      if (DRY_RUN) {
        console.log(`  ${progress} [DRY] Would have processed ${mediaToProcess.length} media items (uploaded=${mediaCount}) for Storage + attribution`);
      } else {
        console.log(`  ${progress} Uploaded ${mediaCount} optimized media items to game-media bucket + DB`);
      }

      stats.success++;
      console.log(`  ${progress} SUCCESS for ${gameInfo.name}`);
    } catch (err: any) {
      // BETTER ERROR HANDLING: per-game continue, record for summary
      const msg = err?.message || String(err);
      console.error(`  ${progress} FAILED: ${msg}`);
      stats.failed++;
      stats.errors.push({ slug: gameInfo.slug, error: msg });
      // continue to next game
    }

    // small pause between games for politeness
    await sleep(150);
  }

  // FINAL SUMMARY / PROGRESS REPORT
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(50));
  console.log('PHASE 1 INGESTION SUMMARY');
  console.log('='.repeat(50));
  console.log(`  Total in seed:     ${stats.total}`);
  console.log(`  Processed:         ${stats.processed}`);
  console.log(`  Success:           ${stats.success}`);
  console.log(`  Failed:            ${stats.failed}`);
  console.log(`  Media uploaded:    ${stats.mediaUploaded}`);
  console.log(`  Duration:          ${durationSec}s`);
  console.log(`  Dry run:           ${DRY_RUN}`);
  if (stats.errors.length > 0) {
    console.log('  Errors:');
    stats.errors.slice(0, 5).forEach((e) => console.log(`    - ${e.slug}: ${e.error}`));
    if (stats.errors.length > 5) console.log(`    ... +${stats.errors.length - 5} more`);
  }
  console.log('='.repeat(50));
  console.log('\nIngestion complete! (Phase 1 image pipeline: Storage + Sharp + attribution + loader ready)');
  console.log('Next: flip NEXT_PUBLIC_USE_REAL_DATA=true and use the async getters in lib/data.ts');
}

main().catch((e) => {
  console.error('Fatal error in ingestion:', e);
  process.exit(1);
});