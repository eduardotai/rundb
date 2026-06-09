#!/usr/bin/env tsx
/**
 * Seed Supabase `games` from lib/mock-data.ts (18 canonical titles).
 * Use when NEXT_PUBLIC_USE_REAL_DATA=true but IGDB ingest credentials are not set up.
 *
 * Requires in .env.local (or environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: npm run seed:games
 */

import { createClient } from '@supabase/supabase-js'
import { GAMES } from '../lib/starter-games'
import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  console.error('Get the service role key from Supabase Dashboard → Project Settings → API.')
  process.exit(1)
}

function normalizeSupabaseProjectUrl(value: string): string {
  return value.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
}

const supabase = createClient(normalizeSupabaseProjectUrl(url), serviceKey)

async function main() {
  console.log(`Seeding ${GAMES.length} games from mock catalog into Supabase...`)

  let ok = 0
  let failed = 0

  for (const game of GAMES) {
    const row = {
      slug: game.slug,
      name: game.name,
      cover_url: game.coverImage,
      genres: game.genres,
      release_year: game.releaseYear,
      developer: game.developer,
      publisher: game.publisher ?? game.developer,
      official_min_reqs: game.officialMinReqs ?? null,
      official_rec_reqs: game.officialRecReqs ?? null,
      steam_app_id: game.steamAppId ?? null,
      igdb_id: game.igdbId ?? null,
      last_ingested_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('games').upsert(row, { onConflict: 'slug' })
    if (error) {
      const hint =
        error.message === 'Invalid API key'
          ? ' (check SUPABASE_SERVICE_ROLE_KEY in .env.local — not the anon key)'
          : ''
      console.error(`  ✗ ${game.slug}: ${error.message}${hint}`)
      failed++
    } else {
      console.log(`  ✓ ${game.slug}`)
      ok++
    }
  }

  const { count, error: countErr } = await supabase
    .from('games')
    .select('*', { count: 'exact', head: true })

  if (countErr) {
    console.error('Count check failed:', countErr.message)
    process.exit(1)
  }

  console.log(`\nDone: ${ok} upserted, ${failed} failed. games table count: ${count ?? '?'}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
