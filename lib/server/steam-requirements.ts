/**
 * Steam store appdetails → official PC min/recommended requirements.
 * Server/script only (network). Pure parsing lives in parse-system-requirements.ts.
 *
 * Rate limits: store.steampowered.com/appdetails is aggressively throttled.
 * Default pacing is conservative; callers can raise delayMs. 429s retry with
 * exponential backoff (+ Retry-After when present).
 */

import type { HardwareSpec } from '../types'
import {
  extractOfficialReqsFromPcRequirements,
  officialReqsDbPatch,
  type SteamOfficialReqs,
} from '../parse-system-requirements'

/** Default gap between Steam store calls (store API is stricter than Web API). */
export const STEAM_DEFAULT_DELAY_MS = 1500
const FETCH_TIMEOUT_MS = 12000
const USER_AGENT = 'RunDB-SteamReqs/1.0 (+https://github.com/example/rundb)'

let lastFetchAt = 0
let configuredDelayMs = STEAM_DEFAULT_DELAY_MS

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Set minimum delay between Steam store fetches for this process.
 * Use ~1500–3000ms for large backfills; 250ms will 429 quickly.
 */
export function setSteamFetchDelayMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) {
    configuredDelayMs = Math.floor(ms)
  }
}

export function getSteamFetchDelayMs(): number {
  return configuredDelayMs
}

/** Shared rate limit for Steam store API. */
export async function steamRateLimit(delayMs?: number): Promise<void> {
  const gap = delayMs ?? configuredDelayMs
  const now = Date.now()
  const wait = gap - (now - lastFetchAt)
  if (wait > 0) await sleep(wait)
  lastFetchAt = Date.now()
}

export interface FetchSteamOfficialReqsOptions {
  /** Min ms between store requests (overrides process default for pacing). */
  delayMs?: number
  /** Retries after 429 / 5xx (default 4). */
  maxRetries?: number
  /** Base backoff for 429 (default 5000ms); doubles each attempt, capped at 120s. */
  rateLimitBackoffMs?: number
}

export interface FetchSteamOfficialReqsResult {
  ok: boolean
  appId: string
  reqs: SteamOfficialReqs
  /** True when Steam returned a successful appdetails payload (even if reqs empty). */
  appFound: boolean
  error?: string
  /** True when the failure is rate limiting (after retries exhausted). */
  rateLimited?: boolean
  /** Attempts used (1 = first try succeeded). */
  attempts?: number
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const asInt = parseInt(header, 10)
  if (!isNaN(asInt) && asInt >= 0) return asInt * 1000
  const when = Date.parse(header)
  if (!isNaN(when)) return Math.max(0, when - Date.now())
  return null
}

async function fetchOnce(
  id: string
): Promise<{ kind: 'ok' | 'rate' | 'http' | 'parse' | 'network'; status?: number; retryAfterMs?: number; entry?: { success?: boolean; data?: { pc_requirements?: unknown } }; error?: string }> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(id)}&cc=us&l=en`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    })

    if (res.status === 429) {
      return {
        kind: 'rate',
        status: 429,
        retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')) ?? undefined,
      }
    }
    if (res.status >= 500) {
      return { kind: 'http', status: res.status, error: `Steam HTTP ${res.status}` }
    }
    if (!res.ok) {
      return { kind: 'http', status: res.status, error: `Steam HTTP ${res.status}` }
    }

    const json = (await res.json().catch(() => null)) as Record<
      string,
      { success?: boolean; data?: { pc_requirements?: unknown } }
    > | null

    const entry = json?.[id]
    if (!entry) {
      // Steam sometimes returns {} when throttled without a proper 429
      return { kind: 'rate', status: res.status, error: 'Empty appdetails body (often soft rate-limit)' }
    }
    return { kind: 'ok', entry }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'network', error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch `pc_requirements` for a Steam AppID and parse to HardwareSpec sides.
 * Retries on 429 / soft throttle / 5xx with exponential backoff.
 */
export async function fetchSteamOfficialRequirements(
  appId: string | number,
  opts: FetchSteamOfficialReqsOptions = {}
): Promise<FetchSteamOfficialReqsResult> {
  const id = String(appId).trim()
  if (!id) {
    return {
      ok: false,
      appId: id,
      reqs: { min: null, rec: null },
      appFound: false,
      error: 'Empty Steam AppID',
    }
  }

  const maxRetries = opts.maxRetries ?? 4
  const baseBackoff = opts.rateLimitBackoffMs ?? 5000
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1
    await steamRateLimit(opts.delayMs)

    const result = await fetchOnce(id)

    if (result.kind === 'ok' && result.entry) {
      if (result.entry.success !== true || !result.entry.data) {
        // success:false is often a real missing app — do not hammer retries
        return {
          ok: false,
          appId: id,
          reqs: { min: null, rec: null },
          appFound: false,
          error: 'Steam appdetails unsuccessful or missing data',
          attempts,
        }
      }
      const reqs = extractOfficialReqsFromPcRequirements(result.entry.data.pc_requirements)
      return { ok: true, appId: id, reqs, appFound: true, attempts }
    }

    const retriable =
      result.kind === 'rate' ||
      result.kind === 'network' ||
      (result.kind === 'http' && (result.status ?? 0) >= 500)

    if (!retriable || attempt === maxRetries) {
      const rateLimited = result.kind === 'rate'
      return {
        ok: false,
        appId: id,
        reqs: { min: null, rec: null },
        appFound: false,
        error:
          result.error ??
          (rateLimited ? 'Steam rate limited (429)' : `Steam fetch failed (${result.kind})`),
        rateLimited,
        attempts,
      }
    }

    const exp = Math.min(120_000, baseBackoff * Math.pow(2, attempt))
    const jitter = Math.floor(Math.random() * 500)
    const waitMs = (result.retryAfterMs && result.retryAfterMs > 0 ? result.retryAfterMs : exp) + jitter
    await sleep(waitMs)
  }

  return {
    ok: false,
    appId: id,
    reqs: { min: null, rec: null },
    appFound: false,
    error: 'Steam fetch exhausted retries',
    rateLimited: true,
    attempts,
  }
}

/**
 * Build Supabase games row fields for a successful requirements fetch.
 * Returns empty object when nothing parseable (caller should not wipe existing data).
 */
export function steamReqsToGameColumns(reqs: SteamOfficialReqs): {
  official_min_reqs?: HardwareSpec
  official_rec_reqs?: HardwareSpec
} {
  return officialReqsDbPatch(reqs)
}

export type { SteamOfficialReqs }
