'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Cpu, Monitor, Scan, Loader2 } from 'lucide-react';
import { sanitizeFullName } from '@/lib/sanitize';
import { showUserError } from '@/lib/toast';
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

    // Browser mode: client-only detection (no network, no storage until explicit Save)
    // Implements primary path from Plan 4 + synthesized browser heuristics (Plan 1).
    try {
      // Parent will typically set detecting state before calling, but we handle here too
      const result = await runBrowserDetection();
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
      ? 'Instant browser scan (WebGL renderer + heuristics). Best on Chrome/Edge Windows. Good starting point — always editable.'
      : 'Open paste helper for highest-accuracy OS command output (dxdiag, lspci, system_profiler, Steam System Info).';

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

/** Pure client-only browser hardware detection (no side effects beyond disposable canvas). */
async function runBrowserDetection(): Promise<DetectedHardware> {
  const raw: any = {};
  let gpu: string | undefined;
  let cpu: string | undefined;
  let ram: number | undefined;
  let resolution: string | undefined;
  let confidence = 0.3;
  const limitations: string[] = [];

  // 1. WebGL UNMASKED_RENDERER — highest value signal for discrete GPUs (Plan 1/4 primary)
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (ext && gl) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
      const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
      if (renderer) {
        // Clean common noise: PCIe/SSE2/Direct3D strings etc.
        const cleaned = renderer
          .replace(/\s*\(.*?PCIe.*?\)/gi, '')
          .replace(/\s*\/.*?(Direct3D|SSE|OpenGL).*/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        gpu = sanitizeFullName(cleaned);
        raw.webglRenderer = renderer;
        raw.webglVendor = vendor;
        confidence = Math.max(confidence, 0.78);
      }
    } else {
      limitations.push('WebGL debug renderer unavailable (privacy extension, Firefox strict, or Safari)');
    }
  } catch {
    limitations.push('WebGL context creation blocked');
  }

  // 2. Navigator memory + cores (approximate, Chrome/Edge mostly)
  const mem = (navigator as any).deviceMemory;
  if (typeof mem === 'number' && mem >= 2) {
    ram = Math.min(128, Math.max(4, Math.round(mem)));
    raw.deviceMemory = mem;
    confidence += 0.07;
  }
  const cores = navigator.hardwareConcurrency;
  if (cores && cores >= 2) {
    raw.hardwareConcurrency = cores;
    if (!cpu) {
      cpu = sanitizeFullName(`${cores}-core CPU (browser)`);
    }
    confidence += 0.05;
  }

  // 3. Resolution (always reliable)
  if (typeof screen !== 'undefined') {
    resolution = `${screen.width}x${screen.height}`;
    raw.screen = { w: screen.width, h: screen.height, dpr: window.devicePixelRatio };
    confidence += 0.08;
  }

  // 4. Basic WebGPU (very new, graceful)
  try {
    if ('gpu' in navigator) {
      const adapter = await (navigator as any).gpu?.requestAdapter?.();
      if (adapter?.info?.description) {
        raw.webgpu = adapter.info.description;
        if (!gpu) {
          gpu = sanitizeFullName(String(adapter.info.description));
          confidence = Math.max(confidence, 0.65);
        }
      }
    }
  } catch {
    // ignore — WebGPU not widely available 2026
  }

  if (!gpu) {
    limitations.push('GPU string generic or unavailable — paste recommended for exact model');
    confidence = Math.min(confidence, 0.45);
  }
  if (limitations.length === 0) {
    limitations.push('Browser-reported values are best-effort; spoofable and may report iGPU or power-limited laptop chips');
  }

  return {
    cpu,
    gpu,
    ram,
    resolution,
    raw,
    method: 'browser',
    confidence: Math.min(0.94, Math.max(0.2, confidence)),
    timestamp: new Date().toISOString(),
    limitations,
  };
}
