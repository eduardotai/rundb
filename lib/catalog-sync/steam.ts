/**
 * Keyless Steam sources for the catalog sync (scripts/catalog-sync.ts).
 *
 * - IStoreBrowseService/GetItems (api.steampowered.com): batched, up to 100 apps per call.
 *   Returns the authoritative content-hashed asset paths (library capsule = portrait cover),
 *   release date, developers/publishers and review counts. No API key.
 * - Store search `filter=popularnew` (store.steampowered.com): Steam's "Popular New Releases"
 *   list, used to discover games released after the catalog was seeded.
 * - appdetails (store.steampowered.com): genres only, for a small number of apps per run
 *   (it is rate limited to roughly 200 requests / 5 minutes).
 *
 * Every function takes an injected `fetch` so tests run without the network.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface SteamStoreItem {
  appid?: number
  id?: number
  success?: number
  visible?: boolean
  name?: string
  /** 0 = game. Other values are software, DLC, music, etc. */
  type?: number
  basic_info?: {
    developers?: { name?: string }[]
    publishers?: { name?: string }[]
  }
  assets?: {
    asset_url_format?: string
    library_capsule?: string
    library_capsule_2x?: string
    header?: string
    header_2x?: string
  }
  release?: {
    steam_release_date?: number
    original_release_date?: number
    is_coming_soon?: boolean
  }
  reviews?: {
    summary_filtered?: { review_count?: number }
  }
}

export interface SteamClientOptions {
  fetch: FetchLike
  /** Pause between Steam calls (ms). Default 1000. */
  delayMs?: number
  retries?: number
  sleep?: (ms: number) => Promise<void>
}

const USER_AGENT = 'RunDB-CatalogSync/1.0 (+https://github.com/eduardotai/rundb)'
const GET_ITEMS_URL = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/'
export const GET_ITEMS_BATCH = 100

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** GET with retry + exponential backoff on 429 / 5xx / network errors. */
async function getWithRetry(url: string, opts: SteamClientOptions): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep
  const retries = opts.retries ?? 3
  let lastError = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(60_000, 2_000 * 2 ** (attempt - 1)))
    try {
      const res = await opts.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.ok) return res
      lastError = `HTTP ${res.status}`
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(`Steam request failed (${lastError}): ${url.split('?')[0]}`)
}

export function buildGetItemsUrl(appids: string[]): string {
  const input = {
    ids: appids.map((id) => ({ appid: Number(id) })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_assets: true, include_release: true, include_basic_info: true, include_reviews: true },
  }
  return `${GET_ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`
}

/** Fetch store items for many apps, 100 per request, pausing between batches. */
export async function fetchSteamItems(
  appids: string[],
  opts: SteamClientOptions & { onBatch?: (done: number, total: number) => void }
): Promise<Map<string, SteamStoreItem>> {
  const sleep = opts.sleep ?? defaultSleep
  const unique = [...new Set(appids.filter((id) => /^\d+$/.test(id)))]
  const out = new Map<string, SteamStoreItem>()
  for (let i = 0; i < unique.length; i += GET_ITEMS_BATCH) {
    if (i > 0) await sleep(opts.delayMs ?? 1000)
    const batch = unique.slice(i, i + GET_ITEMS_BATCH)
    const res = await getWithRetry(buildGetItemsUrl(batch), opts)
    const body = (await res.json()) as { response?: { store_items?: SteamStoreItem[] } }
    for (const item of body.response?.store_items ?? []) {
      const id = String(item.appid ?? item.id ?? '')
      if (id) out.set(id, item)
    }
    opts.onBatch?.(Math.min(i + GET_ITEMS_BATCH, unique.length), unique.length)
  }
  return out
}

/** App ids from Steam's "Popular New Releases" (games only), newest first. */
export async function discoverPopularNewAppIds(opts: SteamClientOptions & { pages?: number }): Promise<string[]> {
  const sleep = opts.sleep ?? defaultSleep
  const ids: string[] = []
  const pageSize = 100
  for (let page = 0; page < (opts.pages ?? 5); page++) {
    if (page > 0) await sleep(opts.delayMs ?? 1000)
    const url =
      'https://store.steampowered.com/search/results/?filter=popularnew&sort_by=Released_DESC' +
      `&category1=998&infinite=1&cc=us&l=english&start=${page * pageSize}&count=${pageSize}`
    const res = await getWithRetry(url, opts)
    const body = (await res.json()) as { results_html?: string; total_count?: number }
    const found = parseSearchAppIds(body.results_html ?? '')
    ids.push(...found)
    if (found.length < pageSize || ids.length >= (body.total_count ?? 0)) break
  }
  return [...new Set(ids)]
}

/** Extract app ids from Steam search result HTML (`data-ds-appid="123"`; bundles list several). */
export function parseSearchAppIds(html: string): string[] {
  const ids: string[] = []
  for (const m of html.matchAll(/data-ds-appid="(\d+)"/g)) ids.push(m[1])
  return [...new Set(ids)]
}

/** Genre names for one app via appdetails (keyless; call sparingly). */
export async function fetchSteamGenres(appid: string, opts: SteamClientOptions): Promise<string[] | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=genres&l=english`
  const res = await getWithRetry(url, opts)
  const body = (await res.json()) as Record<string, { success?: boolean; data?: { genres?: { description?: string }[] } }>
  const entry = body[appid]
  if (!entry?.success) return null
  return (entry.data?.genres ?? []).map((g) => g.description?.trim() ?? '').filter(Boolean)
}
