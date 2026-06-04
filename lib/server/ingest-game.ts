/**
 * Shared per-game IGDB + media enrichment pipeline.
 * Used by scripts/ingest-games.ts, scripts/ingest-games-worker.ts, and admin batch actions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureGameMediaBucket, optimizeAndUploadToGameMedia } from '@/lib/server/game-media'
import { normalizeSlug } from '@/lib/utils'
import { getCatalogCover } from '@/lib/game-cover-catalog'
import { igdbGameMatchesSeed } from '@/lib/igdb-game-match'
import { steamLibraryCoverUrl } from '@/lib/cover-image-url'

const RATE_LIMIT_MS = 300

export interface IngestGameSeed {
  name: string
  slug: string
  steamAppId?: string
}

export interface IngestGameOptions {
  dryRun?: boolean
  skipMedia?: boolean
  igdbClientId?: string
  igdbClientSecret?: string
  onLog?: (msg: string) => void
}

export interface IngestGameResult {
  ok: boolean
  gameId?: string
  error?: string
  mediaUploaded?: number
}

let igdbToken: string | null = null
let igdbTokenExpiry = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getIgdbToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now()
  if (igdbToken && now < igdbTokenExpiry) return igdbToken

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) {
    throw new Error(`IGDB token fetch failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  igdbToken = data.access_token
  igdbTokenExpiry = now + (data.expires_in - 60) * 1000
  return igdbToken!
}

async function igdbRequest(
  clientId: string,
  clientSecret: string,
  endpoint: string,
  body: string
): Promise<any[]> {
  const maxRetries = 5

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await sleep(RATE_LIMIT_MS)
    const token = await getIgdbToken(clientId, clientSecret)
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
    })

    if (res.status === 429) {
      if (attempt === maxRetries) {
        throw new Error(`IGDB ${endpoint} rate limited after ${maxRetries + 1} attempts`)
      }
      await sleep(2000 * (attempt + 1))
      continue
    }

    if (!res.ok) {
      throw new Error(`IGDB ${endpoint} error ${res.status}: ${await res.text()}`)
    }

    return res.json()
  }

  throw new Error(`IGDB ${endpoint} request failed`)
}

async function uploadImageToStorage(
  client: SupabaseClient,
  url: string,
  gameSlug: string,
  type: string,
  dryRun: boolean
): Promise<string | null> {
  if (dryRun) {
    return `https://example.supabase.co/storage/v1/object/public/game-media/games/${gameSlug}/${type}.webp`
  }
  let response = await fetch(url, { headers: { 'User-Agent': 'RunDB-Ingest/1.0' } })
  if (!response.ok && type === 'cover' && url.includes('t_original/')) {
    const fallback = url.replace('t_original/', 't_cover_big_2x/')
    response = await fetch(fallback, { headers: { 'User-Agent': 'RunDB-Ingest/1.0' } })
  }
  if (!response.ok) return null

  const buffer = Buffer.from(await response.arrayBuffer())
  const destPath = `games/${gameSlug}/${type}.webp`
  try {
    return await optimizeAndUploadToGameMedia(client as any, buffer, destPath, {
      width: type.startsWith('cover') ? 900 : 1280,
      quality: type.startsWith('cover') ? 90 : 85,
      format: 'webp',
    })
  } catch {
    return null
  }
}

export async function ingestGame(
  client: SupabaseClient,
  seed: IngestGameSeed,
  opts: IngestGameOptions = {}
): Promise<IngestGameResult> {
  const dryRun = opts.dryRun ?? false
  const skipMedia = opts.skipMedia ?? false
  const log = opts.onLog ?? (() => {})
  const igdbId = opts.igdbClientId ?? process.env.IGDB_CLIENT_ID
  const igdbSecret = opts.igdbClientSecret ?? process.env.IGDB_CLIENT_SECRET

  if (!igdbId || !igdbSecret) {
    return { ok: false, error: 'Missing IGDB_CLIENT_ID or IGDB_CLIENT_SECRET' }
  }

  try {
    if (!dryRun) {
      await ensureGameMediaBucket(client as any)
    }

    const catalogCover = getCatalogCover(seed.slug)
    const steamAppId = seed.steamAppId ?? catalogCover?.steamAppId

    log(`Fetching IGDB metadata for "${seed.name}"...`)
    const igdbGames = await igdbRequest(
      igdbId,
      igdbSecret,
      'games',
      `
        search "${seed.name.replace(/"/g, '\\"')}";
        fields id,name,slug,genres.name,release_dates.y,first_release_date,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,cover.image_id,cover.url,screenshots.image_id,screenshots.url,external_games.uid,external_games.category;
        limit 1;
      `
    )

    if (!igdbGames.length) {
      return { ok: false, error: 'No IGDB match' }
    }

    const igdbGame = igdbGames[0]
    const igdbMatches = igdbGameMatchesSeed(seed.name, igdbGame, steamAppId)
    if (steamAppId && !igdbMatches) {
      return {
        ok: false,
        error: `IGDB result did not match Steam AppID ${steamAppId} for "${seed.name}"`,
      }
    }

    const involved = igdbGame.involved_companies || []
    const devEntry = involved.find((c: any) => c.developer)
    const pubEntry = involved.find((c: any) => c.publisher)
    const developer = devEntry?.company?.name || null
    const publisher = pubEntry?.company?.name || developer

    const nowIso = new Date().toISOString()
    const skeletonCover =
      catalogCover?.url ??
      (steamAppId ? steamLibraryCoverUrl(steamAppId) : null)

    let existingGame: { id: string; cover_url: string | null } | null = null
    if (!dryRun) {
      const { data, error } = await client
        .from('games')
        .select('id, cover_url')
        .eq('slug', seed.slug)
        .maybeSingle()
      if (error) return { ok: false, error: `Find game: ${error.message}` }
      existingGame = data as { id: string; cover_url: string | null } | null
    }

    const gameRow: Record<string, unknown> = {
      slug: seed.slug,
      name: igdbMatches ? igdbGame.name : seed.name,
      cover_url: existingGame?.cover_url ?? skeletonCover,
      steam_app_id: steamAppId ?? catalogCover?.steamAppId ?? null,
    }

    if (igdbMatches) {
      Object.assign(gameRow, {
        igdb_id: String(igdbGame.id),
        genres: (igdbGame.genres || []).map((g: any) => g.name),
        release_year:
          igdbGame.release_dates?.[0]?.y ||
          (igdbGame.first_release_date
            ? new Date(igdbGame.first_release_date * 1000).getFullYear()
            : null),
        developer,
        publisher,
        ingest_status: 'enriched',
        last_ingested_at: nowIso,
      })
    }

    let gameId: string | null = null
    if (!dryRun) {
      if (igdbMatches) {
        const { error, data } = await client
          .from('games')
          .upsert(gameRow, { onConflict: 'slug' })
          .select('id')
          .single()
        if (error) return { ok: false, error: `Upsert: ${error.message}` }
        gameId = (data as { id: string })?.id ?? null
      } else {
        const { data, error } = await client
          .from('games')
          .upsert(
            {
              ...gameRow,
              ingest_status: 'skeleton',
            },
            { onConflict: 'slug', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle()
        if (error) return { ok: false, error: `Skeleton insert: ${error.message}` }

        gameId = (data as { id: string } | null)?.id ?? null
        if (!gameId) {
          const { data: existing, error: existingErr } = await client
            .from('games')
            .select('id')
            .eq('slug', seed.slug)
            .single()
          if (existingErr) return { ok: false, error: `Find skeleton: ${existingErr.message}` }
          gameId = (existing as { id: string })?.id ?? null
        }
      }
    } else {
      gameId = `dry-${seed.slug}`
    }

    if (skipMedia) {
      return { ok: true, gameId: gameId ?? undefined, mediaUploaded: 0 }
    }

    const ATTRIB =
      'Sourced from IGDB (https://www.igdb.com). Images © respective copyright holders. Used for non-commercial informational purposes.'
    const mediaToProcess: Array<{ remoteUrl: string; type: string; sort: number; attr: string }> = []

    if (catalogCover) {
      mediaToProcess.push({
        remoteUrl: catalogCover.url,
        type: 'cover',
        sort: 0,
        attr: catalogCover.attribution,
      })
    } else if (igdbMatches && igdbGame.cover?.image_id) {
      mediaToProcess.push({
        remoteUrl: `https://images.igdb.com/igdb/image/upload/t_original/${igdbGame.cover.image_id}.jpg`,
        type: 'cover',
        sort: 0,
        attr: ATTRIB,
      })
    } else if (steamAppId) {
      mediaToProcess.push({
        remoteUrl: steamLibraryCoverUrl(steamAppId),
        type: 'cover',
        sort: 0,
        attr: 'Cover from Steam CDN (https://store.steampowered.com/). © Valve Corporation.',
      })
    }

    if (igdbMatches) {
      const ss = (igdbGame.screenshots || []).slice(0, 3)
      ss.forEach((s: any, idx: number) => {
        const u = s.image_id
          ? `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${s.image_id}.jpg`
          : 'https:' + (s.url || '').replace('t_thumb', 't_screenshot_big')
        if (u) mediaToProcess.push({ remoteUrl: u, type: `screenshot-${idx}`, sort: 10 + idx, attr: ATTRIB })
      })
    }

    let mediaCount = 0
    let uploadedCoverForGame: string | null = null

    for (const m of mediaToProcess) {
      const publicUrl = await uploadImageToStorage(client, m.remoteUrl, seed.slug, m.type, dryRun)
      if (!publicUrl) continue
      if (m.type === 'cover') uploadedCoverForGame = publicUrl

      if (!dryRun && gameId) {
        const mediaType = m.type.startsWith('screenshot')
          ? 'screenshot'
          : m.type === 'cover'
            ? 'cover'
            : 'artwork'
        const { data: insertedMedia, error } = await client
          .from('game_media')
          .insert({
            game_id: gameId,
            media_type: mediaType,
            url: publicUrl,
            thumbnail_url: publicUrl,
            sort_order: m.sort,
            source: 'igdb',
            attribution: m.attr,
          })
          .select('id')
          .single()
        if (error) return { ok: false, error: `Insert media: ${error.message}` }
        mediaCount++

        if (mediaType === 'cover') {
          const { error: deleteCoverErr } = await client
            .from('game_media')
            .delete()
            .eq('game_id', gameId)
            .eq('media_type', 'cover')
            .neq('id', (insertedMedia as { id: string }).id)
          if (deleteCoverErr) return { ok: false, error: `Dedupe cover: ${deleteCoverErr.message}` }
        } else if (mediaType === 'screenshot') {
          const { error: deleteScreenshotErr } = await client
            .from('game_media')
            .delete()
            .eq('game_id', gameId)
            .eq('media_type', 'screenshot')
            .eq('sort_order', m.sort)
            .neq('id', (insertedMedia as { id: string }).id)
          if (deleteScreenshotErr) return { ok: false, error: `Dedupe screenshot: ${deleteScreenshotErr.message}` }
        }
      } else if (dryRun) {
        mediaCount++
      }
    }

    if (mediaToProcess.length > 0 && mediaCount === 0) {
      return { ok: false, gameId: gameId ?? undefined, error: 'No media uploaded' }
    }

    if (uploadedCoverForGame && !dryRun && gameId) {
      const coverUpdate: Record<string, unknown> = {
        cover_url: uploadedCoverForGame,
        last_ingested_at: nowIso,
      }
      if (igdbMatches) {
        coverUpdate.ingest_status = 'enriched'
      }

      const { error: coverUpdateErr } = await client
        .from('games')
        .update(coverUpdate)
        .eq('id', gameId)
      if (coverUpdateErr) return { ok: false, error: `Update cover: ${coverUpdateErr.message}` }
    }

    return { ok: true, gameId: gameId ?? undefined, mediaUploaded: mediaCount }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export { normalizeSlug }
