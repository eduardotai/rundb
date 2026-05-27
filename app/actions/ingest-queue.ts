'use server'

import { getStaffAccess } from '@/lib/admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { IngestQueueStats } from '@/lib/types'
import {
  getIngestQueueStats,
  getFailedQueueRows,
  retryFailedQueueRows,
  runIngestBatch,
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
