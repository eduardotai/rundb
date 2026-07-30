#!/usr/bin/env tsx
/**
 * Backfill games.official_min_reqs / official_rec_reqs from Steam appdetails pc_requirements.
 *
 * Steam store rate limits are real — you cannot fully avoid them. Mitigations:
 *   - Slow default pacing (1.5s between calls; raise with --delay-ms)
 *   - Retry + exponential backoff on 429
 *   - --stop-after-rate-limits=N (default 3) so a ban window doesn't burn the whole queue
 *   - Re-run anytime: only-missing skips already-filled rows (safe resume)
 *
 * HOW TO RUN:
 *   npm run backfill:steam-reqs -- --dry-run --limit=5
 *   npm run backfill:steam-reqs -- --delay-ms=2500 --limit=50
 *   npm run backfill:steam-reqs -- --delay-ms=3000
 *   npm run backfill:steam-reqs -- --force
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Does NOT need IGDB credentials.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnvLocal } from './load-env-local'
import {
  fetchSteamOfficialRequirements,
  setSteamFetchDelayMs,
  steamReqsToGameColumns,
  STEAM_DEFAULT_DELAY_MS,
} from '../lib/server/steam-requirements'

loadEnvLocal()

interface Flags {
  dryRun: boolean
  force: boolean
  onlyMissing: boolean
  limit?: number
  delayMs: number
  maxRetries: number
  /** Stop the run after this many consecutive rate-limit failures (0 = never). */
  stopAfterRateLimits: number
}

interface GameRow {
  id: string
  slug: string
  name: string
  steam_app_id: number | string
  official_min_reqs: unknown
  official_rec_reqs: unknown
}

function parseArgs(): Flags {
  const flags: Flags = {
    dryRun: process.env.DRY_RUN === 'true',
    force: false,
    onlyMissing: true,
    delayMs: STEAM_DEFAULT_DELAY_MS,
    maxRetries: 4,
    stopAfterRateLimits: 3,
  }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-d') flags.dryRun = true
    else if (arg === '--force' || arg === '-f') {
      flags.force = true
      flags.onlyMissing = false
    } else if (arg === '--only-missing') flags.onlyMissing = true
    else if (arg === '--all') {
      flags.force = true
      flags.onlyMissing = false
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n > 0) flags.limit = n
    } else if (arg.startsWith('--delay-ms=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n >= 0) flags.delayMs = n
    } else if (arg.startsWith('--max-retries=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n >= 0) flags.maxRetries = n
    } else if (arg.startsWith('--stop-after-rate-limits=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n >= 0) flags.stopAfterRateLimits = n
    }
  }
  return flags
}

function normalizeSupabaseProjectUrl(value: string): string {
  return value.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
}

function isEmptyReqs(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (!o.cpu && !o.gpu && (o.ram == null || o.ram === 0)) return true
  }
  return false
}

async function loadCandidates(
  client: SupabaseClient,
  flags: Flags
): Promise<GameRow[]> {
  const pageSize = 500
  const rows: GameRow[] = []
  let from = 0

  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await client
      .from('games')
      .select('id, slug, name, steam_app_id, official_min_reqs, official_rec_reqs')
      .not('steam_app_id', 'is', null)
      .order('slug', { ascending: true })
      .range(from, to)

    if (error) throw new Error(`Load games: ${error.message}`)
    const batch = (data || []) as GameRow[]
    if (!batch.length) break
    rows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }

  let filtered = rows.filter((r) => r.steam_app_id != null && String(r.steam_app_id).trim() !== '')

  if (flags.onlyMissing && !flags.force) {
    filtered = filtered.filter(
      (r) => isEmptyReqs(r.official_min_reqs) || isEmptyReqs(r.official_rec_reqs)
    )
  }

  if (flags.limit != null) filtered = filtered.slice(0, flags.limit)
  return filtered
}

async function main() {
  const flags = parseArgs()
  const start = Date.now()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  setSteamFetchDelayMs(flags.delayMs)

  const client = createClient(normalizeSupabaseProjectUrl(url), key)
  console.log(
    `\n=== Backfill Steam official requirements${flags.dryRun ? ' (DRY RUN)' : ''}${
      flags.force ? ' [FORCE overwrite]' : ' [missing only]'
    } ===`
  )
  console.log(
    `Pacing: delay=${flags.delayMs}ms · max-retries=${flags.maxRetries} · stop-after-rate-limits=${flags.stopAfterRateLimits}\n`
  )

  const candidates = await loadCandidates(client, flags)
  console.log(
    `Candidates: ${candidates.length} game(s)${flags.limit ? ` (limit ${flags.limit})` : ''}`
  )
  if (candidates.length === 0) {
    console.log('Nothing to do — all matching rows already have requirements (or no steam_app_id).')
    process.exit(0)
  }

  const estMin = ((candidates.length * flags.delayMs) / 60000).toFixed(1)
  console.log(`Rough lower-bound time: ~${estMin} min (plus retries on 429)\n`)

  const stats = {
    updated: 0,
    skippedEmpty: 0,
    skippedError: 0,
    dryRunWouldUpdate: 0,
    rateLimited: 0,
  }

  let consecutiveRateLimits = 0
  let stoppedEarly = false

  for (let i = 0; i < candidates.length; i++) {
    const g = candidates[i]!
    const appId = String(g.steam_app_id)
    const prefix = `[${i + 1}/${candidates.length}] ${g.slug} (${appId})`

    const fetched = await fetchSteamOfficialRequirements(appId, {
      delayMs: flags.delayMs,
      maxRetries: flags.maxRetries,
    })

    if (!fetched.ok) {
      if (fetched.rateLimited) {
        consecutiveRateLimits++
        stats.rateLimited++
        console.warn(
          `${prefix} — rate limited after ${fetched.attempts ?? '?'} attempt(s): ${fetched.error}`
        )
        if (
          flags.stopAfterRateLimits > 0 &&
          consecutiveRateLimits >= flags.stopAfterRateLimits
        ) {
          console.error(
            `\nStopped early: ${consecutiveRateLimits} consecutive Steam rate limits.\n` +
              `Wait 15–60 minutes, then re-run the same command (already-filled rows are skipped).\n` +
              `Tip: use a slower pace, e.g. --delay-ms=3000 --limit=30\n`
          )
          stoppedEarly = true
          break
        }
      } else {
        consecutiveRateLimits = 0
        console.warn(`${prefix} — skip: ${fetched.error}`)
      }
      stats.skippedError++
      continue
    }

    consecutiveRateLimits = 0
    let columns = steamReqsToGameColumns(fetched.reqs)

    if (!flags.force) {
      const next: typeof columns = {}
      if (columns.official_min_reqs && isEmptyReqs(g.official_min_reqs)) {
        next.official_min_reqs = columns.official_min_reqs
      }
      if (columns.official_rec_reqs && isEmptyReqs(g.official_rec_reqs)) {
        next.official_rec_reqs = columns.official_rec_reqs
      }
      columns = next
    }

    if (!columns.official_min_reqs && !columns.official_rec_reqs) {
      console.log(`${prefix} — no new fields (empty Steam parse or already filled)`)
      stats.skippedEmpty++
      continue
    }

    const sides = [
      columns.official_min_reqs ? 'min' : null,
      columns.official_rec_reqs ? 'rec' : null,
    ]
      .filter(Boolean)
      .join('+')

    if (flags.dryRun) {
      console.log(`${prefix} — [dry-run] would set ${sides}`)
      stats.dryRunWouldUpdate++
      continue
    }

    const { error } = await client.from('games').update(columns).eq('id', g.id)
    if (error) {
      console.error(`${prefix} — update failed: ${error.message}`)
      stats.skippedError++
      continue
    }
    console.log(`${prefix} — updated ${sides}`)
    stats.updated++
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n--- Summary ---')
  console.log(`  updated:           ${stats.updated}`)
  console.log(`  dry-run would:     ${stats.dryRunWouldUpdate}`)
  console.log(`  skipped (empty):   ${stats.skippedEmpty}`)
  console.log(`  skipped (error):   ${stats.skippedError}`)
  console.log(`  rate limited:      ${stats.rateLimited}`)
  console.log(`  stopped early:     ${stoppedEarly ? 'yes' : 'no'}`)
  console.log(`  elapsed:           ${secs}s`)
  console.log('')

  if (stoppedEarly) process.exit(2)
  process.exit(stats.skippedError > 0 && stats.updated === 0 && stats.dryRunWouldUpdate === 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
