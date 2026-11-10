/**
 * High-resolution cover URL helpers for game banners (cards, detail heroes).
 *
 * Problems solved:
 * - Steam `library_600x900.jpg` is half-res (300×450); `_2x` is true 600×900.
 * - IGDB `t_cover_big` is ~264×374; use `t_cover_big_2x` or `t_original` when ingesting/displaying.
 * - Steam moved newer apps' art to content-hashed paths
 *   (`shared.akamai.steamstatic.com/store_item_assets/steam/apps/<id>/<hash>/library_capsule_2x.jpg`).
 *   The legacy guessed path `/steam/apps/<id>/library_600x900_2x.jpg` 404s for those apps, so a
 *   hashed URL is authoritative and must never be rewritten back to the guessed one.
 * - Supabase `/render/image/` transforms need the Image Transformations add-on. Without it the
 *   endpoint answers 403 FeatureNotEnabled, so it is opt-in via NEXT_PUBLIC_SUPABASE_IMAGE_TRANSFORMS.
 */

const STEAM_HOSTS = ['steamstatic.com', 'steamcdn-a.akamaihd.net']

/** Inlined at build time; only `true` when the Supabase project has Image Transformations. */
const SUPABASE_IMAGE_TRANSFORMS = process.env.NEXT_PUBLIC_SUPABASE_IMAGE_TRANSFORMS === 'true'

/** Parse Steam AppID from a Steam CDN cover URL, if present. */
export function extractSteamAppIdFromUrl(url: string): string | null {
  if (!url) return null
  const m = url.match(/steam(?:cdn[^\s/]*|static)\.com\/(?:store_item_assets\/)?steam\/apps\/(\d+)\//i)
  return m?.[1] ?? null
}

/** Steam's current content-hashed asset host (URLs come from IStoreBrowseService assets). */
export const STEAM_STORE_ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/'

/** True for an authoritative, content-hashed Steam asset URL (never rewrite these). */
export function isSteamStoreAssetUrl(url: string): boolean {
  return /steamstatic\.com\/store_item_assets\//i.test(url)
}

/** Build Steam portrait library art at full CDN resolution. */
export function steamLibraryCoverUrl(appId: number | string, hiRes = true): string {
  const suffix = hiRes ? 'library_600x900_2x.jpg' : 'library_600x900.jpg'
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${suffix}`
}

/** Upgrade a stored Steam cover URL to the 2× asset when available. */
export function upgradeSteamCoverUrl(url: string): string {
  if (!url) return url
  if (!STEAM_HOSTS.some((h) => url.includes(h))) return url
  if (url.includes('library_600x900_2x')) return url
  return url.replace(/library_600x900\.jpg/gi, 'library_600x900_2x.jpg')
}

/** IGDB CDN path for covers — prefer original, else 2× cover_big. */
export function igdbCoverUrl(imageId: string, preferOriginal = true): string {
  const size = preferOriginal ? 'original' : 'cover_big_2x'
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`
}

/** Upgrade IGDB image URLs embedded in paths (thumb/cover_big → higher tier). */
export function upgradeIgdbCoverUrl(url: string, targetWidth = 600): string {
  if (!url.includes('images.igdb.com')) return url
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/upload\/t_([^/]+)\/([^/]+\.jpg)$/i)
    if (!m) return url
    const [, size, file] = m
    if (size === 'original' || size === 'cover_big_2x') return url
    const lowTier = ['thumb', 'cover_small', 'micro', 'cover_big']
    if (!lowTier.some((t) => size === t || size.startsWith(t))) return url
    const next = targetWidth >= 700 ? 'original' : 'cover_big_2x'
    u.pathname = `/igdb/image/upload/t_${next}/${file}`
    return u.href
  } catch {
    return url
  }
}

/** Normalize any cover src to the best available public URL before Next/Image. */
export function upgradeCoverImageSrc(src: string, steamAppId?: string | number | null): string {
  if (!src || src.includes('picsum.photos')) return src
  let out = upgradeSteamCoverUrl(src)
  out = upgradeIgdbCoverUrl(out)

  // Prefer AppID already embedded in the URL over a separate field (prevents DB steam_app_id mismatches)
  const urlAppId = extractSteamAppIdFromUrl(out)
  const fieldAppId = steamAppId != null ? String(steamAppId) : null
  const effectiveAppId = urlAppId ?? fieldAppId

  if (effectiveAppId && STEAM_HOSTS.some((h) => out.includes(h)) && !isSteamStoreAssetUrl(out)) {
    out = steamLibraryCoverUrl(effectiveAppId, true)
  }
  return out
}

/**
 * Next.js custom loader: request appropriately sized transforms per CDN.
 */
export function buildCoverLoaderUrl(
  src: string,
  width: number,
  quality = 85,
  supabaseTransforms = SUPABASE_IMAGE_TRANSFORMS
): string {
  if (!src) return src
  const w = Math.min(Math.max(Math.round(width), 200), 1920)
  const q = Math.min(Math.max(quality, 60), 95)
  // Portrait cover bounding box — `resize=contain` preserves source aspect ratio.
  const h = Math.round((w * 4) / 3)

  try {
    const url = new URL(upgradeCoverImageSrc(src))

    // Supabase Storage image transformation API: opt-in only. Without the add-on the
    // /render/image/ endpoint returns 403 FeatureNotEnabled and every Storage cover breaks.
    if (
      supabaseTransforms &&
      url.hostname.includes('supabase.co') &&
      url.pathname.includes('/storage/v1/object/public/')
    ) {
      url.pathname = url.pathname.replace(
        '/storage/v1/object/public/',
        '/storage/v1/render/image/public/'
      )
      url.searchParams.set('width', String(w))
      url.searchParams.set('height', String(h))
      url.searchParams.set('resize', 'contain')
      url.searchParams.set('quality', String(q))
      return url.href
    }

    return url.href
  } catch {
    return upgradeCoverImageSrc(src)
  }
}
