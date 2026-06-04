'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Edit2, X, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DetectedHardware } from '@/lib/types';

interface DetectedHardwareBannerProps {
  detected: DetectedHardware | null;
  onApply: (detected: DetectedHardware) => void;
  onRefine?: () => void;
  onDismiss?: () => void;
  onTryPaste?: () => void;
  className?: string;
  applied?: boolean;
}

/**
 * DetectedHardwareBanner (Plan 4 §3.2).
 * Educational amber banner shown after detection.
 * Privacy-first with limitations + "nothing is sent until you Save".
 */
export function DetectedHardwareBanner({
  detected,
  onApply,
  onRefine,
  onDismiss,
  onTryPaste,
  className,
  applied = false,
}: DetectedHardwareBannerProps) {
  if (!detected) return null;

  const { method, confidence, cpu, gpu, ram, resolution, refreshRate, limitations = [] } = detected;
  const pct = Math.round(confidence * 100);

  const methodLabel =
    method === 'browser' ? 'Browser scan' :
    method === 'paste' ? 'Pasted from system' :
    method === 'steam' ? 'Steam' : 'Manual';

  const isBrowserHint = method === 'browser' && (cpu?.includes('(browser hint)') || ram == null);

  return (
    <div
      className={cn(
        'mt-2 rounded-md border p-3 text-sm',
        applied
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-amber-500/30 bg-amber-500/5',
        className
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-500/50 text-amber-300 bg-amber-500/10 text-[10px]">
          {methodLabel} • {pct}% confidence
        </Badge>

        <span className="text-xs text-muted-foreground truncate">
          {gpu || cpu || 'Hardware detected'}
          {ram ? ` • ${ram} GB` : ''}
          {resolution ? ` • ${resolution}` : ''}
          {refreshRate ? ` @ ${refreshRate}Hz` : ''}
        </span>

        {isBrowserHint && (
          <span className="text-[10px] text-amber-400/90">CPU/RAM are estimates — paste for accurate values</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!applied && (
            <>
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => onApply(detected)}
                className="h-7 px-2 text-xs"
              >
                <Check className="mr-1 h-3 w-3" /> Apply
              </Button>
              {onTryPaste && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onTryPaste}
                  className="h-7 px-2 text-xs"
                >
                  Paste instead
                </Button>
              )}
              {onRefine && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onRefine}
                  className="h-7 px-2 text-xs"
                >
                  <Edit2 className="mr-1 h-3 w-3" /> Refine
                </Button>
              )}
            </>
          )}
          {onDismiss && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="h-7 w-7 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {limitations && limitations.length > 0 && (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer flex items-center gap-1 hover:text-foreground">
            <HelpCircle className="h-3 w-3" /> What we detected &amp; why (privacy)
          </summary>
          <div className="mt-1 pl-4 space-y-1">
            <p>Client-only scan (WebGL + browser APIs). Nothing is sent to servers until you explicitly Save.</p>
            <ul className="list-disc pl-4">
              {limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <p className="text-amber-300/80">Always review before saving. Paste from your system for highest accuracy.</p>
          </div>
        </details>
      )}
    </div>
  );
}
