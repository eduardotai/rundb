import type { PerformanceTier } from '@/lib/types';

export interface TierSegment {
  tier: PerformanceTier;
  count: number;
  pct: number;    // rounded, for display
  rawPct: number; // unrounded, for bar width
}

// Fixed display order, best -> worst.
export const TIER_ORDER: PerformanceTier[] = [
  'Excellent',
  'Good',
  'Playable',
  'Struggling',
  'Unplayable',
];

export function tierSegments(
  distribution: Record<PerformanceTier, number>,
  total: number,
): TierSegment[] {
  return TIER_ORDER.map((tier) => {
    const count = distribution[tier] ?? 0;
    const rawPct = total > 0 ? (count / total) * 100 : 0;
    return { tier, count, rawPct, pct: Math.round(rawPct) };
  });
}

// Parse a resolution key to its pixel area, or null if unrecognized.
// Handles "1920x1080", "2560×1440", "1080p"/"1440p"/"2160p", and "2K"/"4K"/"8K".
export function resolutionArea(key: string): number | null {
  const s = key.trim().toLowerCase();

  const wh = s.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
  if (wh) return parseInt(wh[1], 10) * parseInt(wh[2], 10);

  const p = s.match(/^(\d{3,4})p$/);
  if (p) {
    const h = parseInt(p[1], 10);
    const w = Math.round((h * 16) / 9);
    return w * h;
  }

  if (s === '2k') return 2560 * 1440;
  if (s === '4k') return 3840 * 2160;
  if (s === '8k') return 7680 * 4320;

  return null;
}

// Order resolution keys by pixel area, most demanding first.
// Known resolutions come before unknown ones; ties and unknowns keep input order (stable).
export function sortResolutions(keys: string[]): string[] {
  return keys
    .map((key, i) => ({ key, i, area: resolutionArea(key) }))
    .sort((a, b) => {
      const aKnown = a.area !== null;
      const bKnown = b.area !== null;
      if (aKnown && bKnown) {
        if (b.area! !== a.area!) return b.area! - a.area!;
        return a.i - b.i;
      }
      if (aKnown) return -1;
      if (bKnown) return 1;
      return a.i - b.i;
    })
    .map((o) => o.key);
}

// Bar fill percentage (0-100) for an FPS value relative to the max across rows.
export function fpsBarPct(fps: number, maxFps: number): number {
  if (maxFps <= 0) return 0;
  const pct = (fps / maxFps) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

export type FpsBucket = 'low' | 'ok' | 'good' | 'high';

// Semantic FPS bucket used to pick a bar color. No Tailwind/CSS here on purpose.
export function fpsBucket(fps: number): FpsBucket {
  if (fps < 30) return 'low';
  if (fps < 60) return 'ok';
  if (fps < 120) return 'good';
  return 'high';
}
