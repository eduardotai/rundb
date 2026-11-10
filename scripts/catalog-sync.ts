/**
 * Keep the games catalog current from Steam (keyless): fixes covers, fills missing
 * metadata and adds notable new releases. Rules live in lib/catalog-sync/plan.ts.
 *
 * Dry run is the DEFAULT. Nothing is written unless --apply is passed.
 *
 *   npm run catalog:sync                                  # dry run against the DB in env
 *   npm run catalog:sync -- --apply                       # write (service role)
 *   npm run catalog:sync -- --snapshot=games.json         # dry run over an exported games table
 *   npm run catalog:sync -- --steam-cache=steam.json      # replay a saved Steam fetch (offline)
 *   npm run catalog:sync -- --steam-cache-out=steam.json  # save the Steam fetch for replay
 *   npm run catalog:sync -- --appids-file=ids.txt --steam-cache-out=steam.json  # fetch only, no DB
 *
 * Options: --since=YYYY-MM-DD (new games released on/after; default 180 days ago),
 *   --min-reviews=50, --max-new=100, --genre-backfill=200, --report=out.json, --no-verify (skip cover HEAD checks)
 * Env for DB access: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { loadEnvLocal } from './load-env-local'
import {
  collectSteamSnapshot,
  headCheck,
  runCatalogSync,
  snapshotCatalogStore,
  supabaseCatalogStore,
  type CatalogStore,
  type SteamSnapshot,
} from '../lib/catalog-sync/run'
import type { CatalogRow } from '../lib/catalog-sync/plan'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}
const num = (name: string, fallback: number) => {
  const v = Number(arg(name))
  return Number.isFinite(v) && arg(name) !== undefined ? v : fallback
}
const log = (m: string) => console.log(`[catalog-sync] ${m}`)

async function main() {
  loadEnvLocal()
  const apply = arg('apply') === 'true'
  const steamOpts = { fetch: globalThis.fetch.bind(globalThis), delayMs: num('delay-ms', 1000) }

  // Fetch-only mode: no DB at all (used to capture Steam data for an offline dry run).
  const appidsFile = arg('appids-file')
  if (appidsFile) {
    const ids = readFileSync(appidsFile, 'utf8').split(/\s+/).filter((s) => /^\d+$/.test(s))
    const rows = ids.map((id) => ({ steam_app_id: id, genres: ['-'] }) as unknown as CatalogRow)
    const snap = await collectSteamSnapshot(rows, steamOpts, { genreBackfillLimit: 0, log })
    const out = arg('steam-cache-out') ?? 'steam-cache.json'
    writeFileSync(out, JSON.stringify(snap))
    log(`fetch-only: ${snap.items.length} items, ${snap.candidateAppIds.length} candidates -> ${out}`)
    return
  }

  let store: CatalogStore
  const snapshotPath = arg('snapshot')
  if (snapshotPath) {
    if (apply) throw new Error('--snapshot is read-only; it cannot be combined with --apply')
    store = snapshotCatalogStore(JSON.parse(readFileSync(snapshotPath, 'utf8')) as CatalogRow[])
  } else {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    store = supabaseCatalogStore(createClient(url, key, { auth: { persistSession: false } }))
  }

  const cachePath = arg('steam-cache')
  const steam = cachePath ? { snapshot: JSON.parse(readFileSync(cachePath, 'utf8')) as SteamSnapshot } : steamOpts
  const since = arg('since') ? new Date(`${arg('since')}T00:00:00Z`) : new Date(Date.now() - 180 * 86_400_000)
  if (Number.isNaN(since.getTime())) throw new Error('--since must be YYYY-MM-DD')

  log(`mode=${apply ? 'APPLY' : 'dry-run'} since=${since.toISOString().slice(0, 10)}`)
  const result = await runCatalogSync({
    store,
    mode: apply ? 'apply' : 'dry-run',
    since,
    minReviews: num('min-reviews', 50),
    maxNew: num('max-new', 100),
    genreBackfillLimit: num('genre-backfill', 200),
    steam,
    // Covers are HEAD-checked against the live CDN even when Steam data is replayed from a cache.
    checkUrl: arg('no-verify') === 'true' ? false : headCheck(steamOpts.fetch),
    log,
  })

  const cacheOut = arg('steam-cache-out')
  if (cacheOut) writeFileSync(cacheOut, JSON.stringify(result.steamSnapshot))

  const { stats, skipped, inserts } = result.plan
  log(`stats ${JSON.stringify(stats)}`)
  log(`skipped: ${skipped.duplicateAppIds.length} duplicate app ids, ${skipped.notOnSteam.length} not on Steam, ${skipped.noSteamAppId.length} without app id`)
  for (const g of inserts.slice(0, 10)) log(`  new: ${g.name} (${g.releaseDate}, ${g.reviewCount} reviews)`)
  if (apply) log(`applied ${JSON.stringify(result.applied)}`)
  const reportPath = arg('report')
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ stats, skipped, inserts, updates: result.plan.updates, applied: result.applied }, null, 2))
  if (result.applied.failed) process.exitCode = 1
}

main().catch((err) => {
  console.error(`[catalog-sync] ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
