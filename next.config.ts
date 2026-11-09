import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Phase 1 image strategy: allow Supabase Storage game-media bucket (public objects)
    // Also allow IGDB CDN during transition / as fallback for external references.
    // See lib/utils.ts for gameMediaLoader (custom for WebP/AVIF/responsive via Supabase transforms or direct).
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.igdb.com',
        pathname: '/igdb/image/upload/**',
      },
      // Steam CDN as potential direct source for some assets (attribution required)
      // Supports both akamai and cloudflare mirrors used by library_600x900.jpg etc.
      {
        protocol: 'https',
        hostname: 'steamcdn-a.akamaihd.net',
        pathname: '/steam/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.cloudflare.steamstatic.com',
        pathname: '/steam/**',
      },
    ],
    // Next.js 16 rejects (400) any `quality` not in this allowlist (default [75]).
    // Covers use 90 (game-card) and 92 (game page hero); keep in sync with `quality=` props.
    qualities: [75, 90, 92],
    // Minimum cache for optimized images (Next default good for our case)
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [256, 360, 480, 600, 720, 900],
  },
};

export default nextConfig;
