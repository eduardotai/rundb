#!/usr/bin/env tsx
/**
 * Backfill games.steam_app_id for rows where it is null.
 * Uses the Steam-first public resolver (static map → Steam search → IGDB).
 *
 *   npm run backfill:steam-appids -- --dry-run
 *   npm run backfill:steam-appids -- --limit=50
 *   npm run backfill:steam-appids
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: IGDB_CLIENT_ID / IGDB_CLIENT_SECRET for better coverage
 */
import { createClient } from '@supabase/supabase-js'
import { loadEnvLocal } from './load-env-local'
import { resolveGameExternalIds } from '../lib/game-id-resolver'
import { STEAM_APP_ID_RESOLVE_MIN_CONFIDENCE } from '../lib/server/ensure-steam-requirements'

loadEnvLocal()

interface Flags {
  dryRun: boolean
  limit?: number
  delayMs: number
}

function parseArgs(): Flags {
  const flags: Flags = { dryRun: false, delayMs: 250 }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-d') flags.dryRun = true
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n > 0) flags.limit = n
    } else if (arg.startsWith('--delay-ms=')) {
      const n = parseInt(arg.split('=')[1] || '', 10)
      if (!isNaN(n) && n >= 0) flags.delayMs = n
    }
  }
  return flags
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const flags = parseArgs()
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(
    /\/rest\/v1\/?$/,
    ''
  )
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const client = createClient(url, key)
  console.log(
    `\n=== Backfill steam_app_id${flags.dryRun ? ' (DRY RUN)' : ''} · min confidence ${STEAM_APP_ID_RESOLVE_MIN_CONFIDENCE} ===\n`
  )

  const pageSize = 500
  const rows: Array<{ id: string; slug: string; name: string }> = []
  let from = 0
  for (;;) {
    let q = client
      .from('games')
      .select('id, slug, name')
      .is('steam_app_id', null)
      .order('slug')
      .range(from, from + pageSize - 1)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const batch = data || []
    if (!batch.length) break
    rows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }

  const candidates = flags.limit ? rows.slice(0, flags.limit) : rows
  console.log(`Candidates: ${candidates.length} (of ${rows.length} missing steam_app_id)\n`)

  const stats = { linked: 0, skipped: 0, failed: 0 }

  for (let i = 0; i < candidates.length; i++) {
    const g = candidates[i]!
    const prefix = `[${i + 1}/${candidates.length}] ${g.slug}`
    try {
      const r = await resolveGameExternalIds(g.name || g.slug, g.slug)
      if (!r.steamAppId || (r.confidence ?? 0) < STEAM_APP_ID_RESOLVE_MIN_CONFIDENCE) {
        console.log(`${prefix} — skip (${r.source}, conf=${r.confidence ?? 0})`)
        stats.skipped++
      } else if (flags.dryRun) {
        console.log(`${prefix} — [dry-run] would set ${r.steamAppId} (${r.source})`)
        stats.linked++
      } else {
        const appNum = Number(r.steamAppId)
        const { error } = await client
          .from('games')
          .update({
            // Do not write external_id_attribution — column may be absent in some DBs.
            steam_app_id: Number.isFinite(appNum) ? appNum : r.steamAppId,
          })
          .eq('id', g.id)
        if (error) {
          console.error(`${prefix} — update failed: ${error.message}`)
          stats.failed++
        } else {
          console.log(`${prefix} — linked ${r.steamAppId} (${r.source})`)
          stats.linked++
        }
      }
    } catch (err) {
      console.error(`${prefix} — error:`, err instanceof Error ? err.message : err)
      stats.failed++
    }
    if (flags.delayMs > 0) await sleep(flags.delayMs)
  }

  console.log('\n--- Summary ---')
  console.log(`  linked:  ${stats.linked}`)
  console.log(`  skipped: ${stats.skipped}`)
  console.log(`  failed:  ${stats.failed}`)
  console.log('')
  process.exit(stats.failed > 0 && stats.linked === 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
