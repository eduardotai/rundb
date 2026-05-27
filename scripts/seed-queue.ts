#!/usr/bin/env tsx
/**
 * Phase A: populate games skeleton rows + game_ingest_queue from seed JSON.
 *
 * Usage:
 *   npm run seed:queue
 *   npm run seed:queue -- --seed-file=seeds/protondb-top-10k.json
 *   npm run seed:queue -- --limit=100
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { loadEnvLocal } from './load-env-local'
import { steamLibraryCoverUrl } from '../lib/cover-image-url'
import type { ProtonDbSeedEntry } from './build-protondb-seed'

loadEnvLocal()

const DEFAULT_SEED = path.join(process.cwd(), 'seeds', 'protondb-top-10k.json')
const BATCH = 100

function parseArgs() {
  let seedFile = DEFAULT_SEED
  let limit: number | null = null
  let dryRun = false

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--seed-file=')) seedFile = arg.split('=')[1]!
    else if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]!, 10)
    else if (arg === '--dry-run') dryRun = true
  }

  return { seedFile, limit, dryRun }
}

async function main() {
  const { seedFile, limit, dryRun } = parseArgs()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dryRun && (!url || !key)) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  if (!fs.existsSync(seedFile)) {
    console.error(`Seed file not found: ${seedFile}`)
    console.error('Run: npm run build:seed')
    process.exit(1)
  }

  let seeds = JSON.parse(fs.readFileSync(seedFile, 'utf8')) as ProtonDbSeedEntry[]
  if (limit && limit > 0) seeds = seeds.slice(0, limit)

  console.log(`Seeding ${seeds.length} games from ${seedFile}${dryRun ? ' (DRY RUN)' : ''}...`)

  const client = url && key ? createClient(url, key) : null
  let gamesUpserted = 0
  let queueUpserted = 0
  let skipped = 0

  for (let i = 0; i < seeds.length; i += BATCH) {
    const batch = seeds.slice(i, i + BATCH)

    for (const seed of batch) {
      const coverUrl = steamLibraryCoverUrl(seed.steamAppId)
      const gameRow = {
        slug: seed.slug,
        name: seed.name,
        steam_app_id: seed.steamAppId,
        cover_url: coverUrl,
        genres: [] as string[],
        ingest_status: 'skeleton' as const,
        last_ingested_at: null,
      }

      if (dryRun || !client) {
        gamesUpserted++
        queueUpserted++
        continue
      }

      const { data: game, error: gameErr } = await client
        .from('games')
        .upsert(gameRow, { onConflict: 'slug' })
        .select('id')
        .single()

      if (gameErr) {
        console.warn(`  skip ${seed.slug}: ${gameErr.message}`)
        skipped++
        continue
      }

      gamesUpserted++

      const queueRow = {
        game_id: game.id,
        steam_app_id: seed.steamAppId,
        name: seed.name,
        slug: seed.slug,
        priority: seed.priority,
        report_count: seed.reportCount,
        status: 'pending' as const,
      }

      const { error: queueErr } = await client
        .from('game_ingest_queue')
        .upsert(queueRow, { onConflict: 'slug' })

      if (queueErr) {
        console.warn(`  queue skip ${seed.slug}: ${queueErr.message}`)
      } else {
        queueUpserted++
      }
    }

    console.log(`  batch ${Math.min(i + BATCH, seeds.length)}/${seeds.length}...`)
  }

  if (dryRun || !client) {
    console.log('\n=== Seed Queue Summary (DRY RUN) ===')
    console.log(`  Would upsert:  ${gamesUpserted} games + queue rows`)
    return
  }

  const { count: queueDepth } = await client
    .from('game_ingest_queue')
    .select('*', { count: 'exact', head: true })

  console.log('\n=== Seed Queue Summary ===')
  console.log(`  Games upserted:  ${gamesUpserted}`)
  console.log(`  Queue upserted:  ${queueUpserted}`)
  console.log(`  Skipped:         ${skipped}`)
  console.log(`  Total in queue:  ${queueDepth ?? '?'}`)
  console.log('\nNext: npm run ingest:worker -- --batch=50')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
