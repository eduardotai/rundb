/**
 * game_ingest_queue operations — shared by worker CLI and admin server actions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestGame, type IngestGameSeed } from '@/lib/server/ingest-game'
import { steamLibraryCoverUrl } from '@/lib/cover-image-url'

import type { IngestQueueStats } from '@/lib/types'
import { discoverLatestSteamGames, filterNewSeeds, type SeedGame } from '@/lib/server/discover-steam-games'

export type QueueStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface QueueRow {
  id: string
  game_id: string | null
  steam_app_id: string
  name: string
  slug: string
  priority: number
  report_count: number
  status: QueueStatus
  attempts: number
  last_error: string | null
}

const STALE_LOCK_MINUTES = 10

export async function getIngestQueueStats(client: SupabaseClient): Promise<IngestQueueStats> {
  const statuses: QueueStatus[] = ['pending', 'processing', 'done', 'failed']
  const counts: Record<string, number> = {}

  for (const s of statuses) {
    const { count } = await client
      .from('game_ingest_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', s)
    counts[s] = count ?? 0
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    total,
  }
}

export async function recoverStaleQueueLocks(client: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('game_ingest_queue')
    .update({ status: 'pending', locked_at: null })
    .eq('status', 'processing')
    .lt('locked_at', cutoff)
    .select('id')

  if (error) {
    console.warn('[queue] stale lock recovery failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

export async function claimQueueBatch(
  client: SupabaseClient,
  batchSize: number,
  excludedIds: Set<string> = new Set()
): Promise<QueueRow[]> {
  await recoverStaleQueueLocks(client)

  const { data: pending, error } = await client
    .from('game_ingest_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .limit(batchSize + excludedIds.size)

  if (error || !pending?.length) return []

  const claimed: QueueRow[] = []
  const now = new Date().toISOString()

  for (const row of (pending as QueueRow[]).filter((item) => !excludedIds.has(item.id)).slice(0, batchSize)) {
    const { data, error: claimErr } = await client
      .from('game_ingest_queue')
      .update({
        status: 'processing',
        locked_at: now,
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()

    if (!claimErr && data) claimed.push(data as QueueRow)
  }

  return claimed
}

async function getPendingQueueRows(
  client: SupabaseClient,
  batchSize: number
): Promise<QueueRow[]> {
  const { data, error } = await client
    .from('game_ingest_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: true })
    .limit(batchSize)

  if (error || !data?.length) return []
  return data as QueueRow[]
}

export async function markQueueRowDone(
  client: SupabaseClient,
  queueId: string,
  gameId: string | null
): Promise<void> {
  await client
    .from('game_ingest_queue')
    .update({
      status: 'done',
      game_id: gameId,
      locked_at: null,
      last_error: null,
    })
    .eq('id', queueId)
}

export async function markQueueRowFailed(
  client: SupabaseClient,
  queueId: string,
  error: string,
  maxAttempts: number,
  currentAttempts: number
): Promise<void> {
  const final = currentAttempts >= maxAttempts
  await client
    .from('game_ingest_queue')
    .update({
      status: final ? 'failed' : 'pending',
      locked_at: null,
      last_error: error.slice(0, 500),
    })
    .eq('id', queueId)

  if (final) {
    const { data: row } = await client
      .from('game_ingest_queue')
      .select('game_id')
      .eq('id', queueId)
      .maybeSingle()
    if (row?.game_id) {
      await client.from('games').update({ ingest_status: 'failed' }).eq('id', row.game_id)
    }
  }
}

export async function retryFailedQueueRows(client: SupabaseClient): Promise<number> {
  const { data, error } = await client
    .from('game_ingest_queue')
    .update({ status: 'pending', last_error: null, locked_at: null, attempts: 0 })
    .eq('status', 'failed')
    .select('id')

  if (error) return 0
  return data?.length ?? 0
}

export async function runIngestBatch(
  client: SupabaseClient,
  batchSize: number,
  opts?: { dryRun?: boolean; maxAttempts?: number; onLog?: (msg: string) => void }
): Promise<{ processed: number; success: number; failed: number }> {
  const maxAttempts = opts?.maxAttempts ?? 3
  const dryRun = opts?.dryRun ?? false
  const rows = dryRun ? await getPendingQueueRows(client, batchSize) : []
  const seenIds = new Set<string>()
  let processed = 0
  let success = 0
  let failed = 0

  while (processed < batchSize) {
    const row = dryRun ? rows[processed] : (await claimQueueBatch(client, 1, seenIds))[0]
    if (!row) break
    seenIds.add(row.id)
    processed++

    const seed: IngestGameSeed = {
      name: row.name,
      slug: row.slug,
      steamAppId: row.steam_app_id,
    }
    const result = await ingestGame(client, seed, {
      dryRun: opts?.dryRun,
      onLog: opts?.onLog,
    })

    if (result.ok) {
      success++
      if (!dryRun) {
        await markQueueRowDone(client, row.id, result.gameId ?? row.game_id)
      }
    } else {
      failed++
      if (!dryRun) {
        await markQueueRowFailed(
          client,
          row.id,
          result.error ?? 'Unknown error',
          maxAttempts,
          row.attempts ?? 1
        )
      }
    }
  }

  return { processed, success, failed }
}

export async function getFailedQueueRows(
  client: SupabaseClient,
  limit = 20
): Promise<QueueRow[]> {
  const { data } = await client
    .from('game_ingest_queue')
    .select('*')
    .eq('status', 'failed')
    .order('priority', { ascending: true })
    .limit(limit)

  return (data ?? []) as QueueRow[]
}

/**
 * Idempotent enqueue of discovered SeedGame[] into games (skeleton) + game_ingest_queue (pending).
 * Modeled exactly on scripts/seed-queue.ts logic but reusable from server actions and CLI.
 * Skips by slug for both games and queue. Sets ingest_status='skeleton' + Steam cover on new skeletons.
 * Returns counts for observability. Does not perform enrichment.
 */
export async function enqueueSeeds(
  client: SupabaseClient,
  seeds: SeedGame[],
  opts?: { onLog?: (msg: string) => void }
): Promise<{ gamesUpserted: number; queueUpserted: number; skipped: number }> {
  const log = opts?.onLog ?? (() => {})
  let gamesUpserted = 0
  let queueUpserted = 0
  let skipped = 0

  for (const seed of seeds) {
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

    // Check existence by slug OR steam_app_id to prevent dups (match AC1 + filterNewSeeds contract)
    let existingGame: { id: string } | null = null
    const { data: bySlugGame, error: bySlugErr } = await client
      .from('games')
      .select('id')
      .eq('slug', seed.slug)
      .maybeSingle()
    if (bySlugErr) {
      log(`  skip ${seed.slug}: ${bySlugErr.message}`)
      skipped++
      continue
    }
    existingGame = bySlugGame

    if (!existingGame && seed.steamAppId) {
      const { data: byAppGame, error: byAppErr } = await client
        .from('games')
        .select('id')
        .eq('steam_app_id', seed.steamAppId)
        .maybeSingle()
      if (byAppErr) {
        log(`  skip ${seed.slug}: ${byAppErr.message}`)
        skipped++
        continue
      }
      existingGame = byAppGame
    }

    let game = existingGame
    if (!game) {
      const { data: insertedGame, error: gameErr } = await client
        .from('games')
        .insert(gameRow)
        .select('id')
        .single()

      if (gameErr) {
        log(`  skip ${seed.slug}: ${gameErr.message}`)
        skipped++
        continue
      }

      game = insertedGame
      gamesUpserted++
    }

    // Queue dedup: by slug (UNIQUE) or by steam_app_id for safety
    let existingQueue: { id: string } | null = null
    const { data: bySlugQ, error: bySlugQErr } = await client
      .from('game_ingest_queue')
      .select('id')
      .eq('slug', seed.slug)
      .maybeSingle()
    if (bySlugQErr) {
      log(`  queue skip ${seed.slug}: ${bySlugQErr.message}`)
      skipped++
      continue
    }
    existingQueue = bySlugQ

    if (!existingQueue && seed.steamAppId) {
      const { data: byAppQ, error: byAppQErr } = await client
        .from('game_ingest_queue')
        .select('id')
        .eq('steam_app_id', seed.steamAppId)
        .maybeSingle()
      if (byAppQErr) {
        log(`  queue skip ${seed.slug}: ${byAppQErr.message}`)
        skipped++
        continue
      }
      existingQueue = byAppQ
    }

    if (existingQueue) {
      continue
    }

    const queueRow = {
      game_id: game!.id,
      steam_app_id: seed.steamAppId,
      name: seed.name,
      slug: seed.slug,
      priority: 0,
      report_count: 0,
      status: 'pending' as const,
    }

    const { error: queueErr } = await client
      .from('game_ingest_queue')
      .insert(queueRow)

    if (queueErr) {
      log(`  queue skip ${seed.slug}: ${queueErr.message}`)
    } else {
      queueUpserted++
    }
  }

  return { gamesUpserted, queueUpserted, skipped }
}

/**
 * Run discovery + DB dedup. Returns ONLY candidates not present by slug or steam_app_id.
 * This is the automated discovery output that can be fed directly into enqueueSeeds (or direct ingest).
 * Satisfies the "produces a list of candidate new games ... that can be fed directly".
 */
export async function discoverFreshCandidates(
  client: SupabaseClient,
  opts: { limit?: number; sinceYear?: number; includeUnreleased?: boolean } = {}
): Promise<SeedGame[]> {
  const discovered = await discoverLatestSteamGames({
    limit: opts.limit,
    sinceYear: opts.sinceYear,
    includeUnreleased: opts.includeUnreleased,
  })

  const { data: existing, error } = await client
    .from('games')
    .select('slug, steam_app_id')

  if (error) {
    throw new Error(`[discoverFreshCandidates] Failed to read existing games for dedup: ${error.message}`)
  }

  return filterNewSeeds(discovered, (existing || []) as Array<{ slug: string; steam_app_id?: string | null }>)
}

