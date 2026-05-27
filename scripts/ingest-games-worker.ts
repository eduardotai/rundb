#!/usr/bin/env tsx
/**
 * Phase B worker: claim pending queue rows and enrich via ingestGame().
 *
 * Usage:
 *   npm run ingest:worker -- --batch=50
 *   DRY_RUN=true npm run ingest:worker -- --batch=5
 */

import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

import { createClient } from '@supabase/supabase-js'
import {
  getIngestQueueStats,
  runIngestBatch,
} from '../lib/server/ingest-queue'

function parseArgs() {
  let batch = 50
  let maxAttempts = 3
  let dryRun = process.env.DRY_RUN === 'true'

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--batch=')) batch = parseInt(arg.split('=')[1]!, 10)
    else if (arg.startsWith('--max-attempts=')) maxAttempts = parseInt(arg.split('=')[1]!, 10)
    else if (arg === '--dry-run' || arg === '-d') dryRun = true
  }

  return { batch, maxAttempts, dryRun }
}

async function main() {
  const { batch, maxAttempts, dryRun } = parseArgs()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    console.error('Missing IGDB_CLIENT_ID or IGDB_CLIENT_SECRET')
    process.exit(1)
  }

  const client = createClient(url, key)

  console.log(`\n=== Ingest Worker${dryRun ? ' (DRY RUN)' : ''} ===`)
  console.log(`Batch size: ${batch}, max attempts: ${maxAttempts}`)

  const before = await getIngestQueueStats(client)
  console.log(
    `Queue before: pending=${before.pending} processing=${before.processing} done=${before.done} failed=${before.failed}`
  )

  const result = await runIngestBatch(client, batch, {
    dryRun,
    maxAttempts,
    onLog: (msg) => console.log(`  ${msg}`),
  })

  const after = await getIngestQueueStats(client)

  console.log('\n=== Batch Summary ===')
  console.log(`  Processed: ${result.processed}`)
  console.log(`  Success:   ${result.success}`)
  console.log(`  Failed:    ${result.failed}`)
  console.log(
    `Queue after:  pending=${after.pending} processing=${after.processing} done=${after.done} failed=${after.failed}`
  )

  if (after.pending > 0) {
    console.log('\nMore pending — re-run: npm run ingest:worker -- --batch=50')
  } else if (after.failed > 0) {
    console.log('\nSome failed — retry from admin or: npm run ingest:worker after admin retry')
  } else {
    console.log('\nQueue complete!')
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
