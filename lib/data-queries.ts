/**
 * Supabase query cores used by lib/data.ts, written against an injected client so tests
 * can drive them with a fake query builder (no network, no framework).
 *
 * Contract: these functions THROW `DataUnavailableError` when Supabase returns an error.
 * Callers (React Query) then show an error state instead of rendering "0 reports" or an
 * empty list that looks like real data.
 */
export class DataUnavailableError extends Error {
  constructor(label: string, cause?: unknown) {
    super(`Could not load ${label}. Please try again.`)
    this.name = 'DataUnavailableError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

/** Minimal shape of a PostgREST response. */
export interface QueryResult<T> {
  data: T | null
  error: unknown
  count?: number | null
}

/**
 * Escape user text for a PostgREST `ilike` pattern. `%` and `_` are LIKE wildcards and are
 * escaped with a backslash (Postgres' default LIKE escape). PostgREST also treats `*` as `%`,
 * which cannot be escaped, so it is replaced by a space.
 */
export function escapeIlike(raw: string): string {
  return raw.replace(/\*/g, ' ').replace(/[\\%_]/g, (c) => `\\${c}`).trim()
}

// Loosely typed builder: supabase-js generics are not needed for these narrow reads.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { from: (table: string) => any }

export interface GlobalCounts {
  /** Every game in the catalog (most have no reports yet). */
  totalGames: number
  /** Approved reports. */
  totalReports: number
  /** Games with at least one approved report (games.report_count is trigger-maintained). */
  gamesWithReports: number
}

export async function fetchGlobalCounts(supabase: Client): Promise<GlobalCounts> {
  const [gamesRes, reportsRes, reportedRes] = (await Promise.all([
    supabase.from('games').select('id', { count: 'exact', head: true }),
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('games').select('id', { count: 'exact', head: true }).gt('report_count', 0),
  ])) as QueryResult<unknown>[]
  for (const res of [gamesRes, reportsRes, reportedRes]) {
    if (res.error || res.count == null) throw new DataUnavailableError('site totals', res.error)
  }
  return {
    totalGames: gamesRes.count ?? 0,
    totalReports: reportsRes.count ?? 0,
    gamesWithReports: reportedRes.count ?? 0,
  }
}

const PAGE = 1000 // PostgREST max-rows on the hosted project
const MAX_PAGES = 20
const ID_CHUNK = 150

/**
 * All games that have at least one approved report, with optional name search and genre.
 * Pages past PostgREST's 1,000-row cap. The tier filter on /games needs exactly this set:
 * a game can only have a dominant tier if it has reports, so the old "load the first
 * 10,000 games" approach (which PostgREST silently capped at 1,000 A–Z rows) is not needed.
 */
export async function fetchReportedGameRows(
  supabase: Client,
  opts: { search?: string; genre?: string } = {}
): Promise<any[]> {
  const rows: any[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase.from('games').select('*').gt('report_count', 0)
    const search = opts.search ? escapeIlike(opts.search) : ''
    if (search) q = q.ilike('name', `%${search}%`)
    if (opts.genre) q = q.contains('genres', [opts.genre])
    const res = (await q.order('name', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1)) as QueryResult<any[]>
    if (res.error) throw new DataUnavailableError('games', res.error)
    const batch = res.data ?? []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

/** Approved report rows for the given games, chunked so the `in()` URL stays short. */
export async function fetchApprovedReportRowsForGames(supabase: Client, gameIds: string[]): Promise<any[]> {
  const ids = [...new Set(gameIds.filter(Boolean))]
  const rows: any[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = (await supabase
        .from('reports')
        .select('*')
        .eq('status', 'approved')
        .in('game_id', chunk)
        .order('created_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)) as QueryResult<any[]>
      if (res.error) throw new DataUnavailableError('reports', res.error)
      const batch = res.data ?? []
      rows.push(...batch)
      if (batch.length < PAGE) break
    }
  }
  return rows
}
/* eslint-enable @typescript-eslint/no-explicit-any */
