/**
 * Catalog sync orchestration: read catalog -> fetch Steam -> plan -> (apply) -> log run.
 * Storage goes through the small CatalogStore interface so tests use an in-memory store and
 * dry runs can use a read-only snapshot. Dry runs never call a write method.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSyncManagedCover, planCatalogSync, toInsertRow, mapSteamItem, type CatalogRow, type GamePatch, type NewGameRow, type SyncPlan, type SteamGameInfo } from './plan'
import { discoverPopularNewAppIds, fetchSteamGenres, fetchSteamItems, type FetchLike, type SteamClientOptions, type SteamStoreItem } from './steam'

export interface CatalogStore {
  listGames(): Promise<CatalogRow[]>
  /** Returns false when the row changed underneath us (cover_url no longer the expected value). */
  updateGame(id: string, patch: GamePatch & { last_synced_at: string }, expectedCoverUrl: string | null): Promise<boolean>
  insertGames(rows: (NewGameRow & { last_synced_at: string })[]): Promise<number>
  logRun(run: SyncRunLog): Promise<void>
}

export interface SyncRunLog {
  started_at: string
  finished_at: string
  mode: 'dry-run' | 'apply'
  status: 'ok' | 'error'
  stats: Record<string, unknown>
  error: string | null
}

/** Steam data needed for one run; can be cached to a file and replayed (offline dry runs). */
export interface SteamSnapshot {
  fetchedAt: string
  items: SteamStoreItem[]
  candidateAppIds: string[]
  genres: Record<string, string[]>
  /** appid -> first cover candidate that answered 200 (null = none did). Filled by verifyCovers. */
  verifiedCovers?: Record<string, string | null>
}

export interface RunOptions {
  store: CatalogStore
  mode: 'dry-run' | 'apply'
  since: Date
  now?: Date
  minReviews?: number
  maxNew?: number
  /** appdetails genre lookups per run for existing games missing genres (new games always get them). */
  genreBackfillLimit?: number
  steam: SteamClientOptions | { snapshot: SteamSnapshot }
  concurrency?: number
  /** HEAD-check new cover URLs before writing them (default true). */
  checkUrl?: ((url: string) => Promise<boolean>) | false
  log?: (msg: string) => void
}

export interface RunResult {
  plan: SyncPlan
  steamSnapshot: SteamSnapshot
  applied: { updated: number; conflicts: number; inserted: number; failed: number }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export async function collectSteamSnapshot(
  rows: CatalogRow[],
  steam: SteamClientOptions,
  opts: { genreBackfillLimit: number; log: (m: string) => void; extraAppIds?: string[] }
): Promise<SteamSnapshot> {
  const candidateAppIds = await discoverPopularNewAppIds(steam).catch((err) => {
    opts.log(`discovery failed, continuing without new games: ${err instanceof Error ? err.message : err}`)
    return [] as string[]
  })
  const catalogIds = rows.map((r) => r.steam_app_id?.trim() ?? '').filter(Boolean)
  const allIds = [...new Set([...catalogIds, ...candidateAppIds, ...(opts.extraAppIds ?? [])])]
  opts.log(`fetching ${allIds.length} Steam items (${candidateAppIds.length} new-release candidates)`)
  const items = await fetchSteamItems(allIds, {
    ...steam,
    onBatch: (done, total) => {
      if (done === total || done % 2000 === 0) opts.log(`  steam items ${done}/${total}`)
    },
  })

  // Genres: new candidates first, then a bounded backfill of existing rows missing genres.
  const known = new Set(catalogIds)
  const genreIds = [
    ...candidateAppIds.filter((id) => !known.has(id) && mapSteamItem(items.get(id) ?? {})?.isGame),
    ...rows
      .filter((r) => r.steam_app_id && (!r.genres || r.genres.length === 0))
      .map((r) => r.steam_app_id!.trim())
      .slice(0, opts.genreBackfillLimit),
  ]
  const genres: Record<string, string[]> = {}
  const sleep = steam.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (const id of [...new Set(genreIds)]) {
    await sleep(Math.max(steam.delayMs ?? 1000, 1500))
    try {
      const g = await fetchSteamGenres(id, steam)
      if (g?.length) genres[id] = g
    } catch (err) {
      opts.log(`  genres ${id} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return { fetchedAt: new Date().toISOString(), items: [...items.values()], candidateAppIds, genres }
}

/** HEAD request; true only for a 2xx image answer. */
export function headCheck(fetchImpl: FetchLike): (url: string) => Promise<boolean> {
  return async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url, { method: 'HEAD' })
        if (res.ok) return true
        if (res.status === 404 || res.status === 403) return false
      } catch {
        // retry once
      }
    }
    return false
  }
}

/**
 * Pick, per app, the first cover candidate that actually loads, but only for apps whose cover
 * would change (managed cover not already one of the candidates) or that would be inserted.
 * Results are stored on the snapshot so a replayed dry run is deterministic.
 */
export async function verifyCovers(
  rows: CatalogRow[],
  steam: Map<string, SteamGameInfo>,
  snapshot: SteamSnapshot,
  checkUrl: ((url: string) => Promise<boolean>) | null,
  concurrency: number
): Promise<void> {
  const verified = (snapshot.verifiedCovers ??= {})
  const inCatalog = new Map<string, CatalogRow>()
  for (const r of rows) if (r.steam_app_id) inCatalog.set(r.steam_app_id.trim(), r)
  const todo: SteamGameInfo[] = []
  for (const info of steam.values()) {
    if (info.appid in verified) continue
    const row = inCatalog.get(info.appid)
    const needs = row
      ? isSyncManagedCover(row.cover_url) && !info.coverCandidates.includes(row.cover_url ?? '')
      : snapshot.candidateAppIds.includes(info.appid)
    if (needs) todo.push(info)
  }
  if (!checkUrl) todo.length = 0
  await pool(todo, concurrency, async (info) => {
    let found: string | null = null
    for (const url of info.coverCandidates) {
      if (await checkUrl!(url)) {
        found = url
        break
      }
    }
    verified[info.appid] = found
  })
  for (const info of steam.values()) {
    if (info.appid in verified) info.coverUrl = verified[info.appid]
    else if (inCatalog.get(info.appid)?.cover_url && info.coverCandidates.includes(inCatalog.get(info.appid)!.cover_url!)) {
      info.coverUrl = inCatalog.get(info.appid)!.cover_url // already on a valid candidate: keep it
    }
  }
}

export async function runCatalogSync(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? (() => {})
  const startedAt = new Date().toISOString()
  const rows = await opts.store.listGames()
  log(`catalog rows: ${rows.length}`)
  try {
    const snapshot =
      'snapshot' in opts.steam
        ? opts.steam.snapshot
        : await collectSteamSnapshot(rows, opts.steam, { genreBackfillLimit: opts.genreBackfillLimit ?? 0, log })

    const steam = new Map<string, SteamGameInfo>()
    for (const item of snapshot.items) {
      const info = mapSteamItem(item)
      if (info) steam.set(info.appid, info)
    }
    const checker =
      opts.checkUrl === false ? null : (opts.checkUrl ?? ('fetch' in opts.steam ? headCheck(opts.steam.fetch) : null))
    await verifyCovers(rows, steam, snapshot, checker, opts.concurrency ?? 8)
    if (checker) log(`covers verified: ${Object.keys(snapshot.verifiedCovers ?? {}).length}`)
    const plan = planCatalogSync(rows, steam, snapshot.candidateAppIds, {
      since: opts.since,
      now: opts.now ?? new Date(),
      minReviews: opts.minReviews ?? 50,
      maxNew: opts.maxNew ?? 100,
      genresByAppId: new Map(Object.entries(snapshot.genres)),
    })

    const applied = { updated: 0, conflicts: 0, inserted: 0, failed: 0 }
    if (opts.mode === 'apply') {
      const stamp = new Date().toISOString()
      await pool(plan.updates, opts.concurrency ?? 8, async (u) => {
        try {
          const ok = await opts.store.updateGame(u.id, { ...u.patch, last_synced_at: stamp }, u.expectedCoverUrl)
          if (ok) applied.updated++
          else applied.conflicts++
        } catch (err) {
          applied.failed++
          log(`  update ${u.slug} failed: ${err instanceof Error ? err.message : err}`)
        }
      })
      if (plan.inserts.length) {
        applied.inserted = await opts.store.insertGames(plan.inserts.map((r) => ({ ...toInsertRow(r), last_synced_at: stamp })))
      }
      await opts.store.logRun({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        mode: 'apply',
        status: applied.failed ? 'error' : 'ok',
        stats: { ...plan.stats, applied, skipped: { duplicateAppIds: plan.skipped.duplicateAppIds.length, notOnSteam: plan.skipped.notOnSteam.length } },
        error: applied.failed ? `${applied.failed} row updates failed` : null,
      })
    }
    return { plan, steamSnapshot: snapshot, applied }
  } catch (err) {
    if (opts.mode === 'apply') {
      await opts.store
        .logRun({ started_at: startedAt, finished_at: new Date().toISOString(), mode: 'apply', status: 'error', stats: {}, error: err instanceof Error ? err.message : String(err) })
        .catch(() => {})
    }
    throw err
  }
}

const GAME_COLUMNS = 'id, slug, name, cover_url, steam_app_id, release_year, developer, publisher, genres'

/** Supabase-backed store (service role, server-side only). */
export function supabaseCatalogStore(client: SupabaseClient): CatalogStore {
  return {
    async listGames() {
      const rows: CatalogRow[] = []
      const page = 1000 // PostgREST max-rows
      for (let from = 0; ; from += page) {
        const { data, error } = await client.from('games').select(GAME_COLUMNS).order('id').range(from, from + page - 1)
        if (error) throw new Error(`games read failed: ${error.message}`)
        rows.push(...((data ?? []) as CatalogRow[]))
        if (!data || data.length < page) break
      }
      return rows
    },
    async updateGame(id, patch, expectedCoverUrl) {
      let q = client.from('games').update(patch).eq('id', id)
      if ('cover_url' in patch) q = expectedCoverUrl == null ? q.is('cover_url', null) : q.eq('cover_url', expectedCoverUrl)
      const { data, error } = await q.select('id')
      if (error) throw new Error(error.message)
      return (data?.length ?? 0) > 0
    },
    async insertGames(rows) {
      // ignoreDuplicates: a slug that appeared since planning is left alone (idempotent re-runs).
      const { data, error } = await client.from('games').upsert(rows, { onConflict: 'slug', ignoreDuplicates: true }).select('id')
      if (error) throw new Error(`insert failed: ${error.message}`)
      return data?.length ?? 0
    },
    async logRun(run) {
      const { error } = await client.from('catalog_sync_runs').insert(run)
      if (error) throw new Error(`run log failed: ${error.message}`)
    },
  }
}

/** Read-only store over a JSON snapshot of the games table (dry runs). Writes throw. */
export function snapshotCatalogStore(rows: CatalogRow[]): CatalogStore {
  const readOnly = async (): Promise<never> => {
    throw new Error('snapshot store is read-only')
  }
  return { listGames: async () => rows, updateGame: readOnly, insertGames: readOnly, logRun: readOnly }
}
