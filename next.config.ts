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
    // Minimum cache for optimized images (Next default good for our case)
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
};

export default nextConfig;
