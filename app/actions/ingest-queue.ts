'use server'

import { getStaffAccess } from '@/lib/admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { IngestQueueStats } from '@/lib/types'
import {
  getIngestQueueStats,
  getFailedQueueRows,
  retryFailedQueueRows,
  runIngestBatch,
  discoverFreshCandidates,
  enqueueSeeds,
  type QueueRow,
} from '@/lib/server/ingest-queue'

async function requireAdmin() {
  const access = await getStaffAccess()
  if (!access.isAdmin) {
    throw new Error('Admin access required')
  }
}

export async function getIngestQueueStatsAction(): Promise<IngestQueueStats> {
  await requireAdmin()
  const client = createServiceClient()
  return getIngestQueueStats(client)
}

export async function getFailedIngestRowsAction(limit = 20): Promise<QueueRow[]> {
  await requireAdmin()
  const client = createServiceClient()
  return getFailedQueueRows(client, limit)
}

export async function retryFailedIngestAction(): Promise<{ reset: number }> {
  await requireAdmin()
  const client = createServiceClient()
  const reset = await retryFailedQueueRows(client)
  return { reset }
}

export async function runIngestBatchAction(
  batchSize = 10
): Promise<{ processed: number; success: number; failed: number; stats: IngestQueueStats }> {
  await requireAdmin()
  const client = createServiceClient()
  const result = await runIngestBatch(client, batchSize, {
    maxAttempts: 3,
    onLog: (msg) => console.log('[admin-ingest]', msg),
  })
  const stats = await getIngestQueueStats(client)
  return { ...result, stats }
}

/**
 * Protected admin-only action: discover latest Steam releases, dedup, and enqueue skeletons + queue rows.
 * End-to-end automated integration path for new games (no hand seeds).
 * Returns summary + refreshed stats. Idempotent.
 */
export async function discoverAndEnqueueLatestAction(opts: { limit?: number } = {}): Promise<{
  ok: boolean
  discovered: number
  fresh: number
  gamesUpserted: number
  queueUpserted: number
  skipped: number
  stats: IngestQueueStats
  message: string
}> {
  await requireAdmin()
  const client = createServiceClient()

  // Use the discoverFreshCandidates helper (does discovery + DB dedup)
  const freshSeeds = await discoverFreshCandidates(client, { limit: opts.limit })
  // To report "discovered" vs "new", we approximate discovered as length of fresh (since fresh fn already dedups).
  // For exact "raw discovered before dedup" use import:latest dry-run. Here the integrated count is authoritative.
  const discoveredCount = freshSeeds.length
  const freshCount = freshSeeds.length

  const enq = await enqueueSeeds(client, freshSeeds, {
    onLog: (msg) => console.log('[admin-discover-enqueue]', msg),
  })

  const stats = await getIngestQueueStats(client)

  const message = freshCount > 0
    ? `Discovered ${discoveredCount} fresh candidate(s); enqueued ${enq.queueUpserted} new (games: ${enq.gamesUpserted}, skipped ${enq.skipped}).`
    : 'No new candidates discovered (all recent Steam titles already in catalog or filtered).'

  return {
    ok: true,
    discovered: discoveredCount,
    fresh: freshCount,
    gamesUpserted: enq.gamesUpserted,
    queueUpserted: enq.queueUpserted,
    skipped: enq.skipped,
    stats,
    message,
  }
}
