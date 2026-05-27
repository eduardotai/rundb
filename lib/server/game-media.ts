// Server/Node only — do not import from Client Components (use @/lib/utils for cn + gameMediaLoader).
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-only: Optimize a raw image buffer with Sharp (webp/avif preferred, responsive width)
 * then upload to Supabase Storage 'game-media' bucket.
 */
export async function optimizeAndUploadToGameMedia(
  supabase: SupabaseClient,
  buffer: Buffer,
  destPath: string,
  options: { width?: number; quality?: number; format?: 'webp' | 'avif' } = {}
): Promise<string> {
  const { width = 1200, quality = 88, format = 'webp' } = options

  const optimizedBuffer = await sharp(buffer)
    .resize(width, null, {
      fit: 'inside',
      withoutEnlargement: false,
      fastShrinkOnLoad: false,
    })
    .sharpen({ sigma: 0.6, m1: 0.5, m2: 0.25 })
    .toFormat(format, { quality, effort: 4 })
    .toBuffer()

  const contentType = format === 'avif' ? 'image/avif' : 'image/webp'

  const { error: uploadErr } = await supabase.storage
    .from('game-media')
    .upload(destPath, optimizedBuffer, {
      contentType,
      upsert: true,
      cacheControl: '31536000, immutable',
    })

  if (uploadErr) {
    throw new Error(`Failed to upload optimized media to ${destPath}: ${uploadErr.message}`)
  }

  const { data } = supabase.storage.from('game-media').getPublicUrl(destPath)
  return data.publicUrl
}

export async function ensureGameMediaBucket(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets()
    const exists = buckets?.some((b) => b.name === 'game-media')
    if (!exists) {
      await supabase.storage.createBucket('game-media', {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
      })
      console.log('[media] Created public bucket "game-media"')
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    if (!message.includes('already exists')) {
      console.warn('[media] ensureGameMediaBucket warning:', message)
    }
  }
}
