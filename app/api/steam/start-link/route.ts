import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateSteamOpenIDLoginUrl } from '@/lib/steam';

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

  // Simple state: userId + timestamp + random (verified on callback)
  const nonce = Math.random().toString(36).slice(2);
  const state = `${user.id}:${Date.now()}:${nonce}`;

  const steamLoginUrl = generateSteamOpenIDLoginUrl(callbackUrl, state);

  return NextResponse.json({ url: steamLoginUrl, state });
}
