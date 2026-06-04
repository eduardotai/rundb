import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifySteamOpenIDCallback, fetchSteamPlayerSummary, extractSteamIdFromClaimedId } from '@/lib/steam';

/**
 * Steam OpenID callback for account linking.
 * Expects the user to already have a valid Supabase session (cookie) when Steam redirects back.
 * Verifies the OpenID response, fetches public profile (if API key present), upserts linked_accounts + denorms profile.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Basic state validation (echoed by Steam)
  const state = params.get('state');
  if (!state) {
    return NextResponse.redirect(new URL('/auth/auth-code-error?reason=missing_state', url.origin));
  }

  const [claimedUserId, tsStr] = state.split(':');
  const ts = parseInt(tsStr || '0', 10);
  if (!claimedUserId || Date.now() - ts > 10 * 60 * 1000) {
    // 10 min expiry
    return NextResponse.redirect(new URL('/auth/auth-code-error?reason=state_expired', url.origin));
  }

  // Verify with Steam
  const steamId = await verifySteamOpenIDCallback(params);
  if (!steamId) {
    return NextResponse.redirect(new URL('/auth/auth-code-error?reason=steam_verify_failed', url.origin));
  }

  // Get current Supabase user from cookies (must be present from the same browser session)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.id || user.id !== claimedUserId) {
    // Mismatch or no session — abort
    return NextResponse.redirect(new URL('/auth/auth-code-error?reason=session_mismatch', url.origin));
  }

  // Fetch public profile snapshot (best effort)
  const apiKey = process.env.STEAM_WEB_API_KEY;
  let profileData: any = { steamid: steamId };

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

  // Upsert into linked_accounts
  const { error: linkErr } = await supabase.from('linked_accounts').upsert({
    user_id: user.id,
    provider: 'steam',
    provider_user_id: steamId,
    provider_data: profileData,
  }, { onConflict: 'user_id,provider' });

  if (linkErr) {
    console.error('[steam] link upsert failed', linkErr);
    return NextResponse.redirect(new URL('/auth/auth-code-error?reason=db_error', url.origin));
  }

  // Denorm onto profiles for fast display (avatar, persona)
  const { error: profErr } = await supabase.from('profiles').upsert({
    id: user.id,
    steam_id: steamId,
    steam_persona: profileData.personaname || null,
    steam_avatar_url: profileData.avatar_url || profileData.avatarfull || null,
    steam_linked_at: new Date().toISOString(),
  });

  if (profErr) {
    console.warn('[steam] profile denorm failed (non-fatal)', profErr.message);
  }

  // Success — redirect back to profile with success flag
  const redirectTo = new URL('/profile?steam_linked=1', url.origin);
  return NextResponse.redirect(redirectTo);
}
