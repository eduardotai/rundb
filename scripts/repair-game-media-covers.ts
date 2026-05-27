#!/usr/bin/env tsx
/**
 * Re-upload authoritative catalog covers to Supabase game_media + games.cover_url.
 * Fixes wrong IGDB art that was previously ingested under the correct slug path.
 *
 * Usage: npx tsx scripts/repair-game-media-covers.ts [slug...]
 *        npx tsx scripts/repair-game-media-covers.ts  (all catalog games)
 */

import { createClient } from '@supabase/supabase-js'
import { GAME_COVER_CATALOG } from '../lib/game-cover-catalog'
import { loadEnvLocal } from './load-env-local'
import {
  ensureGameMediaBucket,
  optimizeAndUploadToGameMedia,
} from '../lib/server/game-media'

loadEnvLocal()

async function downloadCover(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'RunDB-CoverRepair/1.0' } })
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const slugs =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2)
      : Object.keys(GAME_COVER_CATALOG)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  await ensureGameMediaBucket(supabase as any)

  for (const slug of slugs) {
    const catalog = GAME_COVER_CATALOG[slug]
    if (!catalog) {
      console.warn(`Skip ${slug}: not in cover catalog`)
      continue
    }

    const { data: game, error: gameErr } = await supabase
      .from('games')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (gameErr || !game?.id) {
      console.warn(`Skip ${slug}: game row not found`)
      continue
    }

    try {
      const buffer = await downloadCover(catalog.url)
      const destPath = `games/${slug}/cover.webp`
      const publicUrl = await optimizeAndUploadToGameMedia(supabase as any, buffer, destPath, {
        width: 900,
        quality: 88,
      })

      await supabase.from('game_media').delete().eq('game_id', game.id).eq('media_type', 'cover')

      await supabase.from('game_media').insert({
        game_id: game.id,
        media_type: 'cover',
        url: publicUrl,
        source: catalog.source,
        attribution: catalog.attribution,
        sort_order: 0,
      })

      await supabase
        .from('games')
        .update({
          cover_url: catalog.url,
          steam_app_id: catalog.steamAppId ?? null,
          last_ingested_at: new Date().toISOString(),
        })
        .eq('id', game.id)

      console.log(`✓ ${slug} → ${publicUrl}`)
    } catch (err) {
      console.error(`✗ ${slug}:`, err instanceof Error ? err.message : err)
    }
  }
}

main()
