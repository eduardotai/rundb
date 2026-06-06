'use client';

import {
  fpsBarPct,
  fpsBucket,
  sortResolutions,
  type FpsBucket,
} from '@/lib/chart-helpers';

interface FpsResolutionBarsProps {
  avgFpsByResolution: Record<string, number>;
}

// Bucket -> tier CSS variable (reuses globals.css palette; no new CSS).
const bucketVar: Record<FpsBucket, string> = {
  low: 'var(--tier-struggling)',
  ok: 'var(--tier-playable)',
  good: 'var(--tier-excellent)',
  high: 'var(--tier-good)',
};

export function FpsResolutionBars({ avgFpsByResolution }: FpsResolutionBarsProps) {
  const keys = sortResolutions(Object.keys(avgFpsByResolution));

  if (keys.length === 0) {
    return <div className="text-muted-foreground">Not enough data yet.</div>;
  }

  const max = Math.max(...keys.map((k) => avgFpsByResolution[k]));
  const showRef = max >= 60;

  return (
    <div className="space-y-2">
      {keys.map((res) => {
        const fps = avgFpsByResolution[res];
        return (
          <div key={res} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0 font-mono tabular-nums text-muted-foreground">
              {res}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${fpsBarPct(fps, max)}%`,
                  backgroundColor: bucketVar[fpsBucket(fps)],
                }}
              />
              {showRef && (
                <div
                  className="absolute inset-y-0 w-px bg-foreground/30"
                  style={{ left: `${fpsBarPct(60, max)}%` }}
                  aria-hidden
                  title="60 FPS"
                />
              )}
            </div>
            <span className="w-16 shrink-0 text-right font-medium tabular-nums text-foreground">
              {fps} FPS
            </span>
          </div>
        );
      })}
    </div>
  );
}
