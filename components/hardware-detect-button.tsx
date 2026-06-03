'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Cpu, Scan, Loader2 } from 'lucide-react';
import { showUserError } from '@/lib/toast';
import { detectBrowser } from '@/lib/hardware-detector';
import type { DetectedHardware } from '@/lib/types';

interface HardwareDetectButtonProps {
  mode?: 'browser' | 'paste';
  onDetect: (result: DetectedHardware) => void;
  state?: 'idle' | 'detecting' | 'detected' | 'applied' | 'error';
  disabled?: boolean;
  className?: string;
  label?: string;
  /** For paste mode, parent can open modal instead of direct detect */
  onRequestPaste?: () => void;
}

/**
 * Small reusable primitive (Plan 4 §3.2).
 * Icon button placed next to CPU/GPU/RAM/Resolution Labels.
 * Triggers client-only browser detection (WebGL primary) or delegates to paste.
 * State-driven for spinner / label. Educational + privacy-first by design.
 * Reuses shadcn Button, lucide, sanitizeFullName, Sonner via toast.
 * Full anon/guest/auth + USE_REAL parity (pure client, no persistence here).
 */
export function HardwareDetectButton({
  mode = 'browser',
  onDetect,
  state = 'idle',
  disabled,
  className,
  label,
  onRequestPaste,
}: HardwareDetectButtonProps) {
  const isDetecting = state === 'detecting';

  const handleClick = async () => {
    if (disabled || isDetecting) return;

    if (mode === 'paste') {
      onRequestPaste?.();
      return;
    }

    // Browser mode: client-only detection (no network, no storage until explicit Save).
    // Single source of truth lives in lib/hardware-detector.ts (detectBrowser).
    try {
      const result = await detectBrowser();
      onDetect(result);
    } catch (err) {
      console.warn('[HardwareDetectButton] browser detection failed', err);
      showUserError('Detection unavailable in this browser. Try the paste option for exact results.');
      // Still surface a low-confidence fallback result so user can proceed
      const fallback: DetectedHardware = {
        method: 'browser',
        confidence: 0.25,
        timestamp: new Date().toISOString(),
        raw: {},
        limitations: ['WebGL blocked or unavailable in this browser / profile'],
      };
      onDetect(fallback);
    }
  };

  const getIcon = () => {
    if (isDetecting) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    if (mode === 'paste') return <Scan className="h-3.5 w-3.5" />;
    return <Cpu className="h-3.5 w-3.5" />;
  };

  const getButtonLabel = () => {
    if (label) return label;
    if (isDetecting) return 'Scanning...';
    if (mode === 'paste') return 'Paste';
    return 'Detect';
  };

  const title =
    mode === 'browser'
      ? 'Instant browser scan — detects your GPU and screen resolution (Chrome/Edge Windows are most accurate). Add CPU/RAM via Paste or manually. Always editable.'
      : 'Open paste helper for highest-accuracy OS command output (dxdiag, inxi, system_profiler, Steam System Info).';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={disabled || isDetecting}
      className={`h-6 gap-1 px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 ${className || ''}`}
      title={title}
      aria-label={mode === 'browser' ? 'Detect hardware from browser' : 'Paste hardware details from system'}
    >
      {getIcon()}
      <span className="hidden sm:inline">{getButtonLabel()}</span>
    </Button>
  );
}
