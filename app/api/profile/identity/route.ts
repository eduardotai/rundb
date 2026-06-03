import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  AvatarUploadError,
  optimizeAndUploadProfileAvatar,
} from '@/lib/server/profile-avatar';
import { sanitizeFullName } from '@/lib/sanitize';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Sign in before updating your profile.' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid profile update request.' }, { status: 400 });
  }

  const username = sanitizeFullName(String(formData.get('username') ?? '')).slice(0, 32);
  const avatarFile = formData.get('avatar');
  const removeAvatar = formData.get('removeAvatar') === 'true';

  try {
    const service = createServiceClient();
    let avatarUrl: string | null | undefined;

    if (avatarFile instanceof File && avatarFile.size > 0) {
      avatarUrl = await optimizeAndUploadProfileAvatar(service, avatarFile, user.id);
    } else if (removeAvatar) {
      avatarUrl = null;
    }

    const profileUpdate: { id: string; username: string | null; avatar_url?: string | null } = {
      id: user.id,
      username: username || null,
    };

    if (avatarUrl !== undefined) {
      profileUpdate.avatar_url = avatarUrl;
    }

    const { data: profile, error: profileError } = await service
      .from('profiles')
      .upsert(profileUpdate)
      .select('username, avatar_url')
      .single();

    if (profileError) {
      throw new Error(profileError.message);
    }

    const nextMetadata = {
      ...(user.user_metadata ?? {}),
      username: username || undefined,
      avatar_url: (profile.avatar_url as string | null) || undefined,
    };

    await service.auth.admin.updateUserById(user.id, { user_metadata: nextMetadata });

    return NextResponse.json({
      username: (profile.username as string | null) ?? '',
      avatarUrl: (profile.avatar_url as string | null) ?? '',
    });
  } catch (error) {
    const message =
      error instanceof AvatarUploadError
        ? error.message
        : 'Could not update your profile. Please try again.';
    const status = error instanceof AvatarUploadError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
