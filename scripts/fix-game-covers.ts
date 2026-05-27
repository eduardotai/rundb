#!/usr/bin/env tsx
/**
 * Re-upsert specific games after correcting Steam App IDs / cover URLs in mock-data.
 * Usage: npx tsx scripts/fix-game-covers.ts the-last-of-us-part-i assassins-creed-valhalla
 */

import { createClient } from '@supabase/supabase-js'
import { GAME_COVER_CATALOG } from '../lib/game-cover-catalog'
import { GAMES } from '../lib/mock-data'
import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

const slugs = process.argv.slice(2)
if (slugs.length === 0) {
  console.error('Usage: npx tsx scripts/fix-game-covers.ts <slug> [slug...]')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  for (const slug of slugs) {
    const catalog = GAME_COVER_CATALOG[slug]
    const game = GAMES.find((g) => g.slug === slug)
    if (!game) {
      console.error(`Unknown slug: ${slug}`)
      continue
    }
    const coverUrl = catalog?.url ?? game.coverImage
    const steamAppId = catalog?.steamAppId ?? game.steamAppId ?? null
    const { error } = await supabase.from('games').upsert(
      {
        slug: game.slug,
        name: game.name,
        cover_url: coverUrl,
        genres: game.genres,
        release_year: game.releaseYear,
        developer: game.developer,
        publisher: game.publisher ?? game.developer,
        steam_app_id: steamAppId,
        last_ingested_at: new Date().toISOString(),
      },
      { onConflict: 'slug' }
    )
    if (error) console.error(`✗ ${slug}:`, error.message)
    else console.log(`✓ ${slug} → ${coverUrl}`)
  }
}

main()
