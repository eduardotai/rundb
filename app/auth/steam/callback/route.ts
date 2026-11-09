import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  STEAM_LINK_STATE_COOKIE,
  verifySteamOpenIDCallback,
  fetchSteamPlayerSummary,
  validateSteamLinkState,
} from '@/lib/steam';
import { linkSteamAccount, serviceSteamLinkStore, type SteamProfileSnapshot } from '@/lib/server/steam-link';

/**
 * Steam OpenID callback for account linking.
 * Expects the user to already have a valid Supabase session (cookie) when Steam redirects back.
 * Verifies the OpenID response, fetches public profile (if API key present), then writes linked_accounts +
 * the profiles.steam_* denorms with the service role via lib/server/steam-link.ts (clients cannot write
 * either). One Steam account per RunDB user: conflicts redirect with reason=steam_already_linked.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const redirectWithClearedState = (target: URL) => {
    const response = NextResponse.redirect(target);
    response.cookies.set(STEAM_LINK_STATE_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth/steam',
      maxAge: 0,
    });
    return response;
  };

  // Basic state validation (echoed by Steam)
  const state = params.get('state');
  const stateCheck = validateSteamLinkState({
    state,
    cookieValue: request.cookies.get(STEAM_LINK_STATE_COOKIE)?.value,
  });
  if (!stateCheck.ok) {
    return redirectWithClearedState(new URL(`/auth/auth-code-error?reason=${stateCheck.reason}`, url.origin));
  }
  const claimedUserId = stateCheck.userId;

  // Verify with Steam
  const steamId = await verifySteamOpenIDCallback(params);
  if (!steamId) {
    return redirectWithClearedState(new URL('/auth/auth-code-error?reason=steam_verify_failed', url.origin));
  }

  // Get current Supabase user from cookies (must be present from the same browser session)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.id || user.id !== claimedUserId) {
    // Mismatch or no session — abort
    return redirectWithClearedState(new URL('/auth/auth-code-error?reason=session_mismatch', url.origin));
  }

  // Fetch public profile snapshot (best effort)
  const apiKey = process.env.STEAM_WEB_API_KEY;
  let profileData: SteamProfileSnapshot = { steamid: steamId };

  if (apiKey) {
    const summary = await fetchSteamPlayerSummary(steamId, apiKey);
    if (summary) {
      profileData = {
        steamid: summary.steamid,
        personaname: summary.personaname,
        avatar_url: summary.avatarfull,
        profile_url: summary.profileurl,
      };
    }
  }

  // Write the verified link with the service role: clients cannot insert/update linked_accounts
  // or the profiles.steam_* denorms (RLS + column grants), so a link can only come from this
  // server-side OpenID verification. Scoped to the session user checked above. A Steam id that
  // already belongs to another user is refused (never overwritten): reason=steam_already_linked.
  const linked = await linkSteamAccount(serviceSteamLinkStore(createServiceClient()), {
    userId: user.id,
    steamId,
    profile: profileData,
  });
  if (!linked.ok) {
    return redirectWithClearedState(new URL(`/auth/auth-code-error?reason=${linked.reason}`, url.origin));
  }

  // Success — redirect back to profile with success flag
  const redirectTo = new URL('/profile?steam_linked=1', url.origin);
  return redirectWithClearedState(redirectTo);
}
