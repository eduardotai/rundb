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
      if (!isNaN(n) && n > 0) flags.sinceYear = n
    } else if (arg.startsWith('--months=')) {
      // Coarse: discovery filters by release YEAR only, so --months is rounded to the
      // calendar year of the cutoff date (e.g. --months=6 in 2026 => sinceYear 2026, which
      // excludes earlier 2026 releases). Use --since-year for explicit control.
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
  const start = Date.now()

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
    const result = await ingestGame(client, s, { dryRun: flags.dryRun, onLog: (msg) => console.log(`  ${msg}`) })
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
  console.log(`Success: ${stats.success}  Failed: ${stats.failed}`)
  console.log(`Duration: ${((Date.now() - start) / 1000).toFixed(1)}s`)
  if (stats.errors.length) {
    stats.errors.slice(0, 5).forEach((e) => console.log(`  - ${e.slug}: ${e.error}`))
  }
  process.exit(stats.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
