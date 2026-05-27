import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { buildCoverLoaderUrl } from "@/lib/cover-image-url"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Custom image loader for game media (covers, screenshots) served from Supabase Storage.
 * Client-safe — no Node/sharp dependencies.
 *
 *   import Image from 'next/image'
 *   import { gameMediaLoader } from '@/lib/utils'
 */
export function gameMediaLoader({
  src,
  width,
  quality,
}: {
  src: string
  width: number
  quality?: number
}): string {
  return buildCoverLoaderUrl(src, width, quality ?? 85)
}

/**
 * Clean, consistent slug normalization for game seeds, bulk imports, and ingestion.
 * Used by ingest script (Agent 4 / PR 4) and admin tooling to ensure 18 canonical slugs match exactly.
 * Handles punctuation, apostrophes, numbers (e.g. "Warhammer 40,000"), and collapses dashes.
 */
export function normalizeSlug(input: string): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '') // Baldur's -> baldurs
    .replace(/[:,.!?()[\]{}]/g, ' ') // "Witcher 3: Wild Hunt", "40,000" -> spaces
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}
