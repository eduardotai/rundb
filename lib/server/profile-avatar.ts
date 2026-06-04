// Server/Node only. Accepts user-provided image uploads, decodes them with Sharp,
// strips metadata, and stores a normalized WebP avatar in Supabase Storage.
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

const AVATAR_BUCKET = 'profile-avatars';
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_SIZE = 512;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class AvatarUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarUploadError';
  }
}

function hasAllowedMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';

  return isJpeg || isPng || isWebp;
}

export async function ensureProfileAvatarBucket(supabase: SupabaseClient): Promise<void> {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(`Could not list storage buckets: ${listError.message}`);

  if (buckets?.some((bucket) => bucket.name === AVATAR_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, {
    public: true,
    fileSizeLimit: MAX_AVATAR_BYTES,
    allowedMimeTypes: ['image/webp'],
  });

  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`Could not create avatar bucket: ${error.message}`);
  }
}

export async function optimizeAndUploadProfileAvatar(
  supabase: SupabaseClient,
  file: File,
  userId: string
): Promise<string> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AvatarUploadError('Upload a JPEG, PNG, or WebP image.');
  }

  if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError('Profile photo must be 4 MB or smaller.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasAllowedMagicBytes(buffer)) {
    throw new AvatarUploadError('That file does not look like a valid JPEG, PNG, or WebP image.');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: AVATAR_SIZE * AVATAR_SIZE * 64,
    }).metadata();
  } catch {
    throw new AvatarUploadError('That image could not be decoded safely.');
  }

  if (!metadata.width || !metadata.height) {
    throw new AvatarUploadError('Could not read image dimensions.');
  }

  let optimizedBuffer: Buffer;
  try {
    optimizedBuffer = await sharp(buffer, {
      limitInputPixels: AVATAR_SIZE * AVATAR_SIZE * 64,
    })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: 'cover',
        position: 'attention',
        withoutEnlargement: false,
      })
      .webp({ quality: 86, effort: 4 })
      .toBuffer();
  } catch {
    throw new AvatarUploadError('That image could not be converted safely.');
  }

  await ensureProfileAvatarBucket(supabase);

  const destPath = `${userId}/avatar.webp`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(destPath, optimizedBuffer, {
      contentType: 'image/webp',
      upsert: true,
      cacheControl: '31536000, immutable',
    });

  if (uploadError) {
    throw new Error(`Failed to upload profile photo: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(destPath);
  return `${data.publicUrl}?v=${Date.now()}`;
}
