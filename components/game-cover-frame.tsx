'use client';

import Image from 'next/image';
import { cn, gameMediaLoader } from '@/lib/utils';
import { upgradeCoverImageSrc } from '@/lib/cover-image-url';

export interface GameCoverFrameProps {
  src: string;
  alt: string;
  steamAppId?: string | number | null;
  className?: string;
  sizes?: string;
  quality?: number;
  priority?: boolean;
  /** Parent link/card should use Tailwind `group` when enabled. */
  hoverZoom?: boolean;
  /** Blurred fill behind letterboxed art (default on). */
  blurBackdrop?: boolean;
  onError?: () => void;
}

/**
 * Portrait game cover frame — shows the full artwork without cropping.
 * Uses object-contain so mixed aspect ratios (Steam 600×900, IGDB, wide promo banners)
 * are never hard-cropped inside a 2:3 frame.
 */
export function GameCoverFrame({
  src,
  alt,
  steamAppId,
  className,
  sizes = '360px',
  quality = 75,
  priority = false,
  hoverZoom = false,
  blurBackdrop = true,
  onError,
}: GameCoverFrameProps) {
  const coverSrc = upgradeCoverImageSrc(src, steamAppId);

  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {blurBackdrop && (
        <Image
          loader={gameMediaLoader}
          src={coverSrc}
          alt=""
          aria-hidden
          fill
          className="scale-110 object-cover blur-2xl brightness-[0.55]"
          sizes={sizes}
          quality={75}
        />
      )}
      <Image
        loader={gameMediaLoader}
        src={coverSrc}
        alt={alt}
        fill
        className={cn(
          'object-contain object-center',
          hoverZoom && 'transition-transform duration-300 group-hover:scale-[1.03]'
        )}
        sizes={sizes}
        quality={quality}
        priority={priority}
        onError={onError}
      />
    </div>
  );
}
