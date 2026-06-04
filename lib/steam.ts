/**
 * Steam integration helpers (server-only).
 * Used for "Link Steam" (verification + profile enrichment), NOT for direct hardware data.
 * Per Plan 2: Steam Web API / OpenID returns zero per-user CPU/GPU/RAM.
 * Value: "Steam Verified" badges, persona display, opt-in library signals for future suggestions.
 *
 * OpenID verification uses the lightweight check_authentication method recommended by Steam.
 * Never expose STEAM_WEB_API_KEY to client.
 */

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_API_BASE = 'https://api.steampowered.com';

export interface SteamProfile {
  steamid: string;
  personaname: string;
  avatarfull?: string;
  profileurl?: string;
  // Add more as needed from GetPlayerSummaries
}

export interface SteamOwnedGamesSummary {
  game_count: number;
  appids_sample?: number[]; // opt-in, small list of popular titles only for suggestions
}

/**
 * Generate the Steam OpenID login URL.
 * returnTo should be our callback URL (e.g. https://yourdomain.com/auth/steam/callback).
 * We append a state param for CSRF protection (must be validated on return).
 */
export function generateSteamOpenIDLoginUrl(returnTo: string, state: string): string {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${returnTo}?state=${encodeURIComponent(state)}`,
    'openid.realm': new URL(returnTo).origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  url.search = params.toString();
  return url.toString();
}

/**
 * Verify a Steam OpenID callback response.
 * Returns the SteamID (64-bit as string) if valid, null otherwise.
 * Expects the full query params from the return (including the echoed openid.* fields).
 */
export async function verifySteamOpenIDCallback(
  params: URLSearchParams | Record<string, string>
): Promise<string | null> {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params as any);

  // Must have the required fields
  if (!p.get('openid.claimed_id') || !p.get('openid.sig')) {
    return null;
  }

  // Switch to check_authentication mode and re-POST all openid params
  p.set('openid.mode', 'check_authentication');

  const body = p.toString();

  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RunDB/SteamLink (+https://rundb.example)',
    },
    body,
  });

  if (!response.ok) return null;

  const text = await response.text();

  // Steam returns "ns:... \n is_valid:true" (or false)
  if (text.includes('is_valid:true')) {
    const claimed = p.get('openid.claimed_id') || p.get('openid.identity') || '';
    // Format: https://steamcommunity.com/openid/id/76561197960287930
    const match = claimed.match(/\/id\/(\d{17})$/);
    return match ? match[1] : null;
  }

  return null;
}

/**
 * Fetch public player summary using Steam Web API.
 * Requires STEAM_WEB_API_KEY (server only).
 */
export async function fetchSteamPlayerSummary(
  steamId: string,
  apiKey: string
): Promise<SteamProfile | null> {
  if (!apiKey || !steamId) return null;

  const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RunDB/SteamLink' },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const player = json?.response?.players?.[0];
    if (!player) return null;

    return {
      steamid: player.steamid,
      personaname: player.personaname,
      avatarfull: player.avatarfull,
      profileurl: player.profileurl,
    };
  } catch (e) {
    console.warn('[steam] fetchPlayerSummary failed', e);
    return null;
  }
}

/**
 * Fetch owned games count + small opt-in sample (for future "similar library" suggestions).
 * Only call if user explicitly opts in during linking.
 * Returns limited data to respect privacy.
 */
export async function fetchSteamOwnedGames(
  steamId: string,
  apiKey: string,
  includeAppidsSample = false
): Promise<SteamOwnedGamesSummary | null> {
  if (!apiKey || !steamId) return null;

  // include_appinfo=0 to keep payload small; we only need count + optional ids
  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=0&include_played_free_games=0`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'RunDB/SteamLink' } });
    if (!res.ok) return null;

    const json = await res.json();
    const data = json?.response;
    if (!data) return { game_count: 0 };

    const summary: SteamOwnedGamesSummary = {
      game_count: data.game_count || 0,
    };

    if (includeAppidsSample && Array.isArray(data.games)) {
      // Only store a very small sample of popular/well-known titles to avoid dumping entire libraries.
      // In real use we'd filter to a curated list of "signal" games.
      const sample = data.games
        .slice(0, 12) // tiny
        .map((g: any) => g.appid)
        .filter(Boolean);
      if (sample.length) summary.appids_sample = sample;
    }

    return summary;
  } catch (e) {
    console.warn('[steam] fetchOwnedGames failed', e);
    return null;
  }
}

/**
 * Helper to extract SteamID from a full claimed OpenID URL.
 */
export function extractSteamIdFromClaimedId(claimedId: string): string | null {
  const m = claimedId.match(/\/id\/(\d{17})$/);
  return m ? m[1] : null;
}
