import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createSteamLinkState,
  generateSteamOpenIDLoginUrl,
  STEAM_LINK_STATE_COOKIE,
  STEAM_LINK_STATE_TTL_MS,
} from '@/lib/steam';

/**
 * Protected endpoint: Returns a Steam OpenID login URL for the currently authenticated user.
 * Client (while logged in) calls this, then redirects the browser to the returned URL.
 * State is included for basic replay protection.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const origin = request.nextUrl.origin;
  const callbackUrl = `${origin}/auth/steam/callback`;

  // Bind the OpenID state to this browser session so a valid Steam assertion
  // cannot be replayed into another logged-in user's callback.
  const state = createSteamLinkState(user.id);
  const steamLoginUrl = generateSteamOpenIDLoginUrl(callbackUrl, state);
  const response = NextResponse.json({ url: steamLoginUrl, state });

  response.cookies.set(STEAM_LINK_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/auth/steam',
    maxAge: Math.floor(STEAM_LINK_STATE_TTL_MS / 1000),
  });

  return response;
}
