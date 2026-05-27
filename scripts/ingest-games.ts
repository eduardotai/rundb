/**
 * RunDB Phase 1 Game Data Ingestion
 * Delegates per-game enrichment to lib/server/ingest-game.ts
 *
 * HOW TO RUN:
 *   DRY_RUN=true npm run ingest:games
 *   npm run ingest:games
 *   npm run ingest:games -- --seed-file=seeds/protondb-top-10k.json --limit=10
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import { loadEnvLocal } from './load-env-local'
import { ingestGame, normalizeSlug } from '../lib/server/ingest-game'
import { ensureGameMediaBucket } from '../lib/server/game-media'

loadEnvLocal()

interface SeedGame {
  name: string
  slug: string
  steamAppId?: string
}

const DEFAULT_SEED_GAMES: SeedGame[] = [
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
]

function parseCliArgs() {
  const flags: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-d') flags.dryRun = true
    else if (arg.startsWith('--seed-json=')) flags.seedJson = arg.split('=')[1] || ''
    else if (arg.startsWith('--seed-file=')) flags.seedFile = arg.split('=')[1] || ''
    else if (arg.startsWith('--limit=')) flags.limit = arg.split('=')[1] || ''
    else if (arg === '--fetch-popular' || arg === '--popular') flags.fetchPopular = true
    else if (arg === '--admin-trigger') flags.adminTrigger = true
  }
  if (process.env.DRY_RUN === 'true') flags.dryRun = true
  return flags
}

function loadSeedGames(flags: Record<string, string | boolean>): SeedGame[] {
  let games: SeedGame[] = [...DEFAULT_SEED_GAMES]

  const seedFile = flags.seedFile as string | undefined
  if (seedFile) {
    const parsed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
    if (Array.isArray(parsed)) {
      games = parsed.map(mapSeedEntry).filter(Boolean) as SeedGame[]
      console.log(`[seed] Loaded ${games.length} from --seed-file=${seedFile}`)
    }
  }

  const seedJson = (flags.seedJson as string) || process.env.SEED_JSON
  if (seedJson?.trim()) {
    try {
      const parsed = JSON.parse(seedJson.trim())
      if (Array.isArray(parsed) && parsed.length > 0) {
        games = parsed.map(mapSeedEntry).filter(Boolean) as SeedGame[]
        console.log(`[seed] Loaded ${games.length} from SEED_JSON / --seed-json`)
      }
    } catch (e: unknown) {
      console.warn('[seed] Failed to parse SEED_JSON:', e)
    }
  }

  if (flags.limit) {
    const n = parseInt(String(flags.limit), 10)
    if (!isNaN(n) && n > 0) games = games.slice(0, n)
  }

  return games
}

function mapSeedEntry(g: Record<string, unknown>): SeedGame | null {
  const name = String(g.name || g.Name || '').trim()
  const provided = String(g.slug || g.Slug || '').trim()
  const slug = provided || normalizeSlug(name)
  const steamAppId = g.steamAppId ?? g.steam_app_id
  if (!name || !slug) return null
  return {
    name,
    slug,
    steamAppId: steamAppId != null ? String(steamAppId) : undefined,
  }
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key)
}

async function main() {
  const cliFlags = parseCliArgs()
  const dryRun = cliFlags.dryRun === true
  const games = loadSeedGames(cliFlags)

  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    console.error('Missing IGDB_CLIENT_ID or IGDB_CLIENT_SECRET in .env.local')
    process.exit(1)
  }

  console.log(`\n=== Starting Ingestion${dryRun ? ' (DRY RUN)' : ''} ===`)
  console.log(`${games.length} games`)

  const client = getSupabaseClient()
  if (!dryRun) {
    try {
      await ensureGameMediaBucket(client as any)
    } catch (e: unknown) {
      console.warn('[init] bucket warning:', e)
    }
  }

  const stats = { success: 0, failed: 0, errors: [] as Array<{ slug: string; error: string }> }
  const start = Date.now()

  for (let i = 0; i < games.length; i++) {
    const g = games[i]!
    const progress = `[${i + 1}/${games.length}]`
    console.log(`\n${progress} ${g.name} (${g.slug})`)

    const result = await ingestGame(client, g, {
      dryRun,
      onLog: (msg) => console.log(`  ${msg}`),
    })

    if (result.ok) {
      stats.success++
      console.log(`  ${progress} SUCCESS (media=${result.mediaUploaded ?? 0})`)
    } else {
      stats.failed++
      stats.errors.push({ slug: g.slug, error: result.error ?? 'unknown' })
      console.error(`  ${progress} FAILED: ${result.error}`)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`Success: ${stats.success}  Failed: ${stats.failed}`)
  console.log(`Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`)
  if (stats.errors.length) {
    stats.errors.slice(0, 5).forEach((e) => console.log(`  - ${e.slug}: ${e.error}`))
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
