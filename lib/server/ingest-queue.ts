/**
 * game_ingest_queue operations — shared by worker CLI and admin server actions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestGame, type IngestGameSeed } from '@/lib/server/ingest-game'

import type { IngestQueueStats } from '@/lib/types'

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
