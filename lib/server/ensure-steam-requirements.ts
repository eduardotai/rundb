/**
 * Lazy ensure of Steam official min/recommended requirements for a game row.
 * Used by the game-detail Server Action; reuses fetch + merge rules with ingest.
 *
 * Interactive path: short retries, DB negative cache, claim-for-stampede.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { HardwareSpec } from '../types'
import {
  fetchSteamOfficialRequirements,
  steamReqsToGameColumns,
  type FetchSteamOfficialReqsOptions,
  type FetchSteamOfficialReqsResult,
} from './steam-requirements'

// ---------------------------------------------------------------------------
// Cooldowns (single source of truth)
// ---------------------------------------------------------------------------

/** Steam OK but no parseable PC reqs — do not re-hit for 30 days. */
export const OFFICIAL_REQS_EMPTY_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** After 429 / soft throttle — wait 60 minutes before retry. */
export const OFFICIAL_REQS_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000
/** Hard error (missing app / network) — wait 24 hours. */
export const OFFICIAL_REQS_ERROR_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Pending claim abandoned if older than 2 minutes. */
export const OFFICIAL_REQS_PENDING_TTL_MS = 2 * 60 * 1000

export type OfficialReqsStatus =
  | 'pending'
  | 'ready'
  | 'empty'
  | 'error'
  | 'rate_limited'

export type EnsureDecision =
  | { action: 'skip'; reason: string; status?: OfficialReqsStatus | null }
  | { action: 'fetch'; reason: string }

export interface OfficialReqsGameRow {
  id: string
  slug: string
  steam_app_id: number | string | null
  official_min_reqs: unknown
  official_rec_reqs: unknown
  official_reqs_checked_at: string | null
  official_reqs_status: string | null
}

export interface EnsureOfficialReqsResult {
  ok: boolean
  status:
    | 'skipped'
    | 'ready'
    | 'empty'
    | 'rate_limited'
    | 'error'
    | 'not_found'
    | 'misconfigured'
    | 'in_flight'
  reason?: string
  message?: string
  officialMinReqs?: HardwareSpec | null
  officialRecReqs?: HardwareSpec | null
  /** True when this call hit Steam (not a pure skip). */
  fetched?: boolean
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** True when value is null/undefined or has no usable cpu/gpu/ram. */
export function isEmptyOfficialReqs(v: unknown): boolean {
  if (v == null) return true
  if (typeof v !== 'object' || Array.isArray(v)) return true
  const o = v as Record<string, unknown>
  const cpu = typeof o.cpu === 'string' ? o.cpu.trim() : ''
  const gpu = typeof o.gpu === 'string' ? o.gpu.trim() : ''
  const ram = o.ram
  const ramOk =
    typeof ram === 'number' ? ram > 0 : typeof ram === 'string' && ram.trim() !== ''
  if (!cpu && !gpu && !ramOk) return true
  return false
}

export function hasAnyOfficialReqs(min: unknown, rec: unknown): boolean {
  return !isEmptyOfficialReqs(min) || !isEmptyOfficialReqs(rec)
}

/**
 * Merge fetched columns into existing without wiping filled sides.
 * Only includes keys that should be written.
 */
export function mergeOfficialReqsColumns(
  existingMin: unknown,
  existingRec: unknown,
  fetched: { official_min_reqs?: HardwareSpec; official_rec_reqs?: HardwareSpec },
  force = false
): { official_min_reqs?: HardwareSpec; official_rec_reqs?: HardwareSpec } {
  const out: { official_min_reqs?: HardwareSpec; official_rec_reqs?: HardwareSpec } = {}
  if (fetched.official_min_reqs) {
    if (force || isEmptyOfficialReqs(existingMin)) {
      out.official_min_reqs = fetched.official_min_reqs
    }
  }
  if (fetched.official_rec_reqs) {
    if (force || isEmptyOfficialReqs(existingRec)) {
      out.official_rec_reqs = fetched.official_rec_reqs
    }
  }
  return out
}

function ageMs(checkedAt: string | null | undefined, now: number): number | null {
  if (!checkedAt) return null
  const t = Date.parse(checkedAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, now - t)
}

/**
 * Decide whether to hit Steam for this row.
 *
 * v1 policy: if any side already has parseable reqs → skip (do not re-fetch
 * solely for a missing secondary side). Negative cache uses status + checked_at.
 */
export function shouldEnsureOfficialReqs(
  row: Pick<
    OfficialReqsGameRow,
    | 'steam_app_id'
    | 'official_min_reqs'
    | 'official_rec_reqs'
    | 'official_reqs_checked_at'
    | 'official_reqs_status'
  >,
  now: number = Date.now()
): EnsureDecision {
  const appId = row.steam_app_id != null ? String(row.steam_app_id).trim() : ''
  if (!appId) {
    return { action: 'skip', reason: 'no_steam_id' }
  }

  if (hasAnyOfficialReqs(row.official_min_reqs, row.official_rec_reqs)) {
    return {
      action: 'skip',
      reason: 'already_filled',
      status: (row.official_reqs_status as OfficialReqsStatus) || 'ready',
    }
  }

  const status = (row.official_reqs_status || null) as OfficialReqsStatus | null
  const age = ageMs(row.official_reqs_checked_at, now)

  if (status === 'ready') {
    return { action: 'skip', reason: 'ready', status: 'ready' }
  }

  if (status === 'empty' && age != null && age < OFFICIAL_REQS_EMPTY_TTL_MS) {
    return { action: 'skip', reason: 'negative_cache', status: 'empty' }
  }

  if (
    status === 'rate_limited' &&
    age != null &&
    age < OFFICIAL_REQS_RATE_LIMIT_COOLDOWN_MS
  ) {
    return { action: 'skip', reason: 'cooldown', status: 'rate_limited' }
  }

  if (status === 'error' && age != null && age < OFFICIAL_REQS_ERROR_COOLDOWN_MS) {
    return { action: 'skip', reason: 'error_cooldown', status: 'error' }
  }

  if (status === 'pending' && age != null && age < OFFICIAL_REQS_PENDING_TTL_MS) {
    return { action: 'skip', reason: 'in_flight', status: 'pending' }
  }

  return { action: 'fetch', reason: status ? `retry_${status}` : 'never_checked' }
}

export function statusAfterSuccessfulFetch(
  columns: { official_min_reqs?: HardwareSpec; official_rec_reqs?: HardwareSpec },
  existingMin: unknown,
  existingRec: unknown
): 'ready' | 'empty' {
  const min = columns.official_min_reqs ?? existingMin
  const rec = columns.official_rec_reqs ?? existingRec
  return hasAnyOfficialReqs(min, rec) ? 'ready' : 'empty'
}

// ---------------------------------------------------------------------------
// In-process singleflight (same instance only)
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<EnsureOfficialReqsResult>>()

// ---------------------------------------------------------------------------
// Ensure implementation
// ---------------------------------------------------------------------------

export type SteamFetchFn = (
  appId: string | number,
  opts?: FetchSteamOfficialReqsOptions
) => Promise<FetchSteamOfficialReqsResult>

export interface EnsureGameOfficialRequirementsOptions {
  /** Interactive defaults: maxRetries 1, low delay. */
  fetchOpts?: FetchSteamOfficialReqsOptions
  fetchFn?: SteamFetchFn
  now?: number
  log?: (msg: string) => void
}

const INTERACTIVE_FETCH_OPTS: FetchSteamOfficialReqsOptions = {
  delayMs: 0,
  maxRetries: 1,
  rateLimitBackoffMs: 2000,
}

function asHardwareSpec(v: unknown): HardwareSpec | null {
  if (isEmptyOfficialReqs(v)) return null
  return v as HardwareSpec
}

function resultFromRow(
  row: OfficialReqsGameRow,
  status: EnsureOfficialReqsResult['status'],
  reason?: string
): EnsureOfficialReqsResult {
  return {
    ok: status === 'skipped' || status === 'ready' || status === 'empty' || status === 'in_flight',
    status,
    reason,
    officialMinReqs: asHardwareSpec(row.official_min_reqs),
    officialRecReqs: asHardwareSpec(row.official_rec_reqs),
    fetched: false,
  }
}

async function loadGameBySlug(
  client: SupabaseClient,
  slug: string
): Promise<OfficialReqsGameRow | null> {
  const { data, error } = await client
    .from('games')
    .select(
      'id, slug, steam_app_id, official_min_reqs, official_rec_reqs, official_reqs_checked_at, official_reqs_status'
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(`Load game: ${error.message}`)
  return (data as OfficialReqsGameRow | null) ?? null
}

/**
 * Try to claim the row for fetching (status=pending). Returns true if we won the claim.
 */
async function claimForFetch(
  client: SupabaseClient,
  row: OfficialReqsGameRow,
  nowIso: string
): Promise<boolean> {
  // Optimistic claim: only if still unchecked / expired pending / retryable statuses
  // and still missing both sides (another writer may have filled).
  const { data, error } = await client
    .from('games')
    .update({
      official_reqs_status: 'pending',
      official_reqs_checked_at: nowIso,
    })
    .eq('id', row.id)
    .is('official_min_reqs', null) // weak guard; merge still handles partial
    .select('id')
    .maybeSingle()

  // Note: is null on min alone is imperfect when min is {} empty object.
  // We re-check decision after re-read; claim is best-effort stampede dampening.
  if (error) {
    // Column missing or race — fall through to fetch without hard fail
    return true
  }
  if (data?.id) return true

  // If update matched 0 rows (e.g. min already set), still allow if shouldEnsure says fetch
  // because empty object may not be SQL NULL.
  const { data: again, error: err2 } = await client
    .from('games')
    .update({
      official_reqs_status: 'pending',
      official_reqs_checked_at: nowIso,
    })
    .eq('id', row.id)
    .or(
      `official_reqs_checked_at.is.null,official_reqs_status.eq.rate_limited,official_reqs_status.eq.error,official_reqs_status.eq.empty,official_reqs_status.eq.pending`
    )
    .select('id')
    .maybeSingle()

  if (err2) return true
  return Boolean(again?.id)
}

async function writeOutcome(
  client: SupabaseClient,
  gameId: string,
  patch: {
    official_min_reqs?: HardwareSpec
    official_rec_reqs?: HardwareSpec
    official_reqs_status: OfficialReqsStatus
    official_reqs_checked_at: string
  }
): Promise<void> {
  const { error } = await client.from('games').update(patch).eq('id', gameId)
  if (error) throw new Error(`Update official reqs: ${error.message}`)
}

async function ensureOnce(
  client: SupabaseClient,
  slug: string,
  opts: EnsureGameOfficialRequirementsOptions
): Promise<EnsureOfficialReqsResult> {
  const log = opts.log ?? (() => {})
  const now = opts.now ?? Date.now()
  const nowIso = new Date(now).toISOString()
  const fetchFn = opts.fetchFn ?? fetchSteamOfficialRequirements
  const fetchOpts = { ...INTERACTIVE_FETCH_OPTS, ...opts.fetchOpts }

  const row = await loadGameBySlug(client, slug)
  if (!row) {
    return { ok: false, status: 'not_found', message: 'Game not found' }
  }

  const decision = shouldEnsureOfficialReqs(row, now)
  if (decision.action === 'skip') {
    log(`[ensure-steam-reqs] slug=${slug} skip reason=${decision.reason}`)
    if (decision.reason === 'in_flight') {
      return resultFromRow(row, 'in_flight', decision.reason)
    }
    // Map skip reasons to result status for client UX
    if (decision.status === 'empty') {
      return resultFromRow(row, 'empty', decision.reason)
    }
    if (decision.status === 'rate_limited') {
      return {
        ok: false,
        status: 'rate_limited',
        reason: decision.reason,
        message: 'Steam rate limit cooldown active',
        officialMinReqs: asHardwareSpec(row.official_min_reqs),
        officialRecReqs: asHardwareSpec(row.official_rec_reqs),
        fetched: false,
      }
    }
    if (decision.status === 'error') {
      return {
        ok: false,
        status: 'error',
        reason: decision.reason,
        message: 'Previous official requirements fetch failed recently',
        officialMinReqs: asHardwareSpec(row.official_min_reqs),
        officialRecReqs: asHardwareSpec(row.official_rec_reqs),
        fetched: false,
      }
    }
    return resultFromRow(row, 'skipped', decision.reason)
  }

  const claimed = await claimForFetch(client, row, nowIso)
  if (!claimed) {
    const latest = (await loadGameBySlug(client, slug)) ?? row
    const again = shouldEnsureOfficialReqs(latest, now)
    if (again.action === 'skip') {
      log(`[ensure-steam-reqs] slug=${slug} skip after claim miss reason=${again.reason}`)
      return resultFromRow(latest, again.reason === 'in_flight' ? 'in_flight' : 'skipped', again.reason)
    }
    // Lost claim but still should fetch — another worker may be mid-flight
    if (latest.official_reqs_status === 'pending') {
      return resultFromRow(latest, 'in_flight', 'in_flight')
    }
  }

  const appId = String(row.steam_app_id).trim()
  log(`[ensure-steam-reqs] slug=${slug} fetch appId=${appId}`)
  const fetched = await fetchFn(appId, fetchOpts)

  if (!fetched.ok) {
    const st: OfficialReqsStatus = fetched.rateLimited ? 'rate_limited' : 'error'
    await writeOutcome(client, row.id, {
      official_reqs_status: st,
      official_reqs_checked_at: new Date().toISOString(),
    })
    log(`[ensure-steam-reqs] slug=${slug} status=${st} error=${fetched.error ?? ''}`)
    return {
      ok: false,
      status: st,
      message: fetched.error ?? 'Steam fetch failed',
      reason: st,
      officialMinReqs: asHardwareSpec(row.official_min_reqs),
      officialRecReqs: asHardwareSpec(row.official_rec_reqs),
      fetched: true,
    }
  }

  const columns = steamReqsToGameColumns(fetched.reqs)
  const merged = mergeOfficialReqsColumns(
    row.official_min_reqs,
    row.official_rec_reqs,
    columns,
    false
  )
  const finalStatus = statusAfterSuccessfulFetch(merged, row.official_min_reqs, row.official_rec_reqs)
  const checkedAt = new Date().toISOString()

  await writeOutcome(client, row.id, {
    ...merged,
    official_reqs_status: finalStatus,
    official_reqs_checked_at: checkedAt,
  })

  log(`[ensure-steam-reqs] slug=${slug} status=${finalStatus}`)

  const min = merged.official_min_reqs ?? asHardwareSpec(row.official_min_reqs)
  const rec = merged.official_rec_reqs ?? asHardwareSpec(row.official_rec_reqs)

  return {
    ok: true,
    status: finalStatus,
    reason: decision.reason,
    officialMinReqs: min,
    officialRecReqs: rec,
    fetched: true,
  }
}

/**
 * Ensure official min/rec for a game slug. Safe to call on every game-detail visit;
 * cooldowns and filled rows short-circuit without Steam.
 */
export async function ensureGameOfficialRequirements(
  client: SupabaseClient,
  slug: string,
  opts: EnsureGameOfficialRequirementsOptions = {}
): Promise<EnsureOfficialReqsResult> {
  const normalized = slug.trim()
  if (!normalized || normalized.length > 200) {
    return { ok: false, status: 'error', message: 'Invalid slug' }
  }

  const existing = inFlight.get(normalized)
  if (existing) return existing

  const promise = ensureOnce(client, normalized, opts).finally(() => {
    inFlight.delete(normalized)
  })
  inFlight.set(normalized, promise)
  return promise
}

/**
 * Apply Steam official requirements during ingest (longer retries OK).
 * Never clears existing official_* with nulls. Stamps cache status when columns exist.
 */
export async function applySteamOfficialRequirements(
  client: SupabaseClient,
  gameId: string,
  steamAppId: string | undefined | null,
  dryRun: boolean,
  log: (msg: string) => void,
  fetchFn: SteamFetchFn = fetchSteamOfficialRequirements
): Promise<boolean> {
  if (!steamAppId) return false

  log(`Fetching Steam official requirements for AppID ${steamAppId}...`)
  const fetched = await fetchFn(steamAppId)
  if (!fetched.ok) {
    log(`  Steam requirements skipped: ${fetched.error ?? 'unknown error'}`)
    if (!dryRun) {
      // Best-effort status stamp; ignore if columns not migrated yet
      try {
        await client
          .from('games')
          .update({
            official_reqs_status: fetched.rateLimited ? 'rate_limited' : 'error',
            official_reqs_checked_at: new Date().toISOString(),
          })
          .eq('id', gameId)
      } catch {
        /* ignore */
      }
    }
    return false
  }

  const columns = steamReqsToGameColumns(fetched.reqs)
  if (!columns.official_min_reqs && !columns.official_rec_reqs) {
    log('  Steam returned no parseable PC min/recommended requirements')
    if (!dryRun) {
      try {
        await client
          .from('games')
          .update({
            official_reqs_status: 'empty',
            official_reqs_checked_at: new Date().toISOString(),
          })
          .eq('id', gameId)
      } catch {
        /* ignore */
      }
    }
    return false
  }

  const sides = [
    columns.official_min_reqs ? 'min' : null,
    columns.official_rec_reqs ? 'rec' : null,
  ]
    .filter(Boolean)
    .join('+')

  if (dryRun) {
    log(`  [dry-run] would set official_${sides}_reqs`)
    return true
  }

  const { error } = await client
    .from('games')
    .update({
      ...columns,
      official_reqs_status: 'ready',
      official_reqs_checked_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) {
    // Retry without cache columns if migration not applied
    if (/official_reqs_/i.test(error.message)) {
      const { error: err2 } = await client.from('games').update(columns).eq('id', gameId)
      if (err2) {
        log(`  Steam requirements update failed: ${err2.message}`)
        return false
      }
    } else {
      log(`  Steam requirements update failed: ${error.message}`)
      return false
    }
  }
  log(`  Official requirements updated (${sides})`)
  return true
}
